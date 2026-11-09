import Capacitor
import ClerkKit
import Foundation
import os

private enum ClerkNativeAuthError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self {
        case .message(let message): return message
        }
    }
}

@objc(ClerkNativeAuthPlugin)
public class ClerkNativeAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ClerkNativeAuthPlugin"
    public let jsName = "ClerkNativeAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAuthState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDebugTrace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startHostedAuth", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signOut", returnType: CAPPluginReturnPromise)
    ]

    private static let logger = Logger(
        subsystem: "com.corvlio.fielddashboard",
        category: "ClerkNativeAuth"
    )
    private static let redirectURL = "com.corvlio.fielddashboard://callback"
    private static let callbackScheme = "com.corvlio.fielddashboard"

    private let traceLock = NSLock()
    private var lastNativeStep = "plugin instance created"
    @MainActor private var configuredPublishableKey: String?

    func markRegistered() {
        recordStep("registered")
    }

    private func recordStep(_ step: String) {
        traceLock.lock()
        lastNativeStep = step
        traceLock.unlock()
        Self.logger.info("native step: \(step, privacy: .public)")
    }

    private func currentStep() -> String {
        traceLock.lock()
        defer { traceLock.unlock() }
        return lastNativeStep
    }

    private func reject(_ call: CAPPluginCall, operation: String, error: Error) {
        let reason = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        let message = "\(operation) failed: \(reason). Last native step: \(currentStep())."
        Self.logger.error("\(message, privacy: .public)")
        call.reject(message)
    }

    // Capacitor 7 dispatches Objective-C selectors on its bridge queue. Keep
    // selectors nonisolated, record arrival before hopping, and reject every
    // thrown MainActor operation rather than leaving its JavaScript call pending.
    @objc func initialize(_ call: CAPPluginCall) {
        recordStep("initialize called")
        Task { @MainActor [weak self] in
            guard let self else {
                call.reject("Initialize failed: native sign-in plugin is unavailable. Last native step: initialize called.")
                return
            }
            self.recordStep("initialize entered MainActor")
            do {
                try self.initializeOnMainActor(call)
            } catch {
                self.reject(call, operation: "Initialize", error: error)
            }
        }
    }

    @objc func getAuthState(_ call: CAPPluginCall) {
        recordStep("state load called")
        Task { @MainActor [weak self] in
            guard let self else {
                call.reject("State load failed: native sign-in plugin is unavailable. Last native step: state load called.")
                return
            }
            do {
                try self.getAuthStateOnMainActor(call)
            } catch {
                self.reject(call, operation: "State load", error: error)
            }
        }
    }

    @objc func getDebugTrace(_ call: CAPPluginCall) {
        let step = currentStep()
        Self.logger.info("native step trace requested: \(step, privacy: .public)")
        call.resolve(["lastStep": step])
    }

    @objc func startHostedAuth(_ call: CAPPluginCall) {
        recordStep("hosted auth called")
        Task { @MainActor [weak self] in
            guard let self else {
                call.reject("Hosted sign-in failed: native sign-in plugin is unavailable. Last native step: hosted auth called.")
                return
            }
            do {
                try await self.startHostedAuthOnMainActor(call)
            } catch {
                self.reject(call, operation: "Hosted sign-in", error: error)
            }
        }
    }

    @objc func getToken(_ call: CAPPluginCall) {
        recordStep("token request called")
        Task { @MainActor [weak self] in
            guard let self else {
                call.reject("Token request failed: native sign-in plugin is unavailable. Last native step: token request called.")
                return
            }
            do {
                try await self.getTokenOnMainActor(call)
            } catch {
                self.reject(call, operation: "Token request", error: error)
            }
        }
    }

    @objc func signOut(_ call: CAPPluginCall) {
        recordStep("sign-out called")
        Task { @MainActor [weak self] in
            guard let self else {
                call.reject("Sign-out failed: native sign-in plugin is unavailable. Last native step: sign-out called.")
                return
            }
            do {
                try await self.signOutOnMainActor(call)
            } catch {
                self.reject(call, operation: "Sign-out", error: error)
            }
        }
    }

    @MainActor
    private func initializeOnMainActor(_ call: CAPPluginCall) throws {
        recordStep("initialize validating key")
        guard let publishableKey = call.getString("publishableKey")?
            .trimmingCharacters(in: .whitespacesAndNewlines),
            publishableKey.hasPrefix("pk_live_") || publishableKey.hasPrefix("pk_test_") else {
            throw ClerkNativeAuthError.message("A valid Clerk publishable key is required")
        }

        if let configuredPublishableKey {
            guard configuredPublishableKey == publishableKey else {
                throw ClerkNativeAuthError.message("Clerk was already initialized with a different environment key")
            }
            recordStep("configure already done")
            call.resolve(["configured": true])
            recordStep("initialize resolved")
            return
        }

        let options = Clerk.Options(
            redirectConfig: .init(
                redirectUrl: Self.redirectURL,
                callbackUrlScheme: Self.callbackScheme
            )
        )
        recordStep("configure started")
        Clerk.configure(publishableKey: publishableKey, options: options)
        configuredPublishableKey = publishableKey
        recordStep("configure done")
        // Initialization deliberately does not wait for session restoration,
        // network refresh, or keychain-backed auth-state loading.
        call.resolve(["configured": true])
        recordStep("initialize resolved")
    }

    @MainActor
    private func getAuthStateOnMainActor(_ call: CAPPluginCall) throws {
        recordStep("state load started")
        try ensureConfigured()
        let state = authStatePayload()
        call.resolve(state)
        recordStep("state loaded")
    }

    @MainActor
    private func startHostedAuthOnMainActor(_ call: CAPPluginCall) async throws {
        let mode = call.getString("mode") ?? "signIn"
        recordStep("hosted auth started")
        try ensureConfigured()
        if mode == "signUp" {
            try await Clerk.shared.auth.startHostedAuth(mode: .signUp)
        } else {
            try await Clerk.shared.auth.startHostedAuth()
        }
        recordStep("hosted auth returned")
        let state = authStatePayload()
        call.resolve(state)
        recordStep("state loaded")
    }

    @MainActor
    private func getTokenOnMainActor(_ call: CAPPluginCall) async throws {
        recordStep("token request started")
        try ensureConfigured()
        let token = try await Clerk.shared.auth.getToken()
        call.resolve(["token": token as Any? ?? NSNull()])
        recordStep("token loaded")
    }

    @MainActor
    private func signOutOnMainActor(_ call: CAPPluginCall) async throws {
        recordStep("sign-out started")
        try ensureConfigured()
        try await Clerk.shared.auth.signOut()
        let state = authStatePayload()
        call.resolve(state)
        recordStep("signed out")
    }

    @MainActor
    private func ensureConfigured() throws {
        guard configuredPublishableKey != nil else {
            throw ClerkNativeAuthError.message("Clerk native authentication has not been initialized")
        }
    }

    @MainActor
    private func authStatePayload() -> [String: Any] {
        let clerk = Clerk.shared
        guard let user = clerk.user else {
            return ["isSignedIn": false, "user": NSNull()]
        }

        let emails = user.emailAddresses.map { ["emailAddress": $0.emailAddress] }
        let primaryEmail = user.primaryEmailAddress?.emailAddress
        let fullName = [user.firstName, user.lastName]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")

        return [
            "isSignedIn": true,
            "user": [
                "id": user.id,
                "fullName": fullName.isEmpty ? NSNull() : fullName as Any,
                "firstName": user.firstName as Any? ?? NSNull(),
                "lastName": user.lastName as Any? ?? NSNull(),
                "primaryEmailAddress": primaryEmail as Any? ?? NSNull(),
                "emailAddresses": emails
            ]
        ]
    }
}
