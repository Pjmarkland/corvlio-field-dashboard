import Capacitor
import ClerkKit
import Foundation
import os

@objc(ClerkNativeAuthPlugin)
public class ClerkNativeAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ClerkNativeAuthPlugin"
    public let jsName = "ClerkNativeAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAuthState", returnType: CAPPluginReturnPromise),
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

    @MainActor private var configuredPublishableKey: String?

    // Capacitor 7 invokes Objective-C selectors on its serial bridge queue.
    // Keep these entry points nonisolated and explicitly hop to MainActor before
    // touching ClerkKit or its main-actor state.
    @objc func initialize(_ call: CAPPluginCall) {
        Self.logger.info("initialize selector received")
        Task { @MainActor [weak self] in
            guard let self else {
                Self.logger.error("initialize could not reach the plugin instance")
                call.reject("Native sign-in plugin is unavailable.")
                return
            }
            Self.logger.info("initialize entered MainActor")
            await self.initializeOnMainActor(call)
        }
    }

    @objc func getAuthState(_ call: CAPPluginCall) {
        Self.logger.info("getAuthState selector received")
        Task { @MainActor [weak self] in
            guard let self else {
                Self.logger.error("getAuthState could not reach the plugin instance")
                call.reject("Native sign-in plugin is unavailable.")
                return
            }
            await self.getAuthStateOnMainActor(call)
        }
    }

    @objc func startHostedAuth(_ call: CAPPluginCall) {
        Self.logger.info("startHostedAuth selector received")
        Task { @MainActor [weak self] in
            guard let self else {
                Self.logger.error("startHostedAuth could not reach the plugin instance")
                call.reject("Native sign-in plugin is unavailable.")
                return
            }
            await self.startHostedAuthOnMainActor(call)
        }
    }

    @objc func getToken(_ call: CAPPluginCall) {
        Self.logger.info("getToken selector received")
        Task { @MainActor [weak self] in
            guard let self else {
                Self.logger.error("getToken could not reach the plugin instance")
                call.reject("Native sign-in plugin is unavailable.")
                return
            }
            await self.getTokenOnMainActor(call)
        }
    }

    @objc func signOut(_ call: CAPPluginCall) {
        Self.logger.info("signOut selector received")
        Task { @MainActor [weak self] in
            guard let self else {
                Self.logger.error("signOut could not reach the plugin instance")
                call.reject("Native sign-in plugin is unavailable.")
                return
            }
            await self.signOutOnMainActor(call)
        }
    }

    @MainActor
    private func initializeOnMainActor(_ call: CAPPluginCall) async {
        Self.logger.info("initialize validating Clerk publishable key")
        guard let publishableKey = call.getString("publishableKey")?
            .trimmingCharacters(in: .whitespacesAndNewlines),
            publishableKey.hasPrefix("pk_live_") || publishableKey.hasPrefix("pk_test_") else {
            Self.logger.error("initialize rejected an invalid Clerk publishable key")
            call.reject("A valid Clerk publishable key is required.")
            return
        }

        if let configuredPublishableKey {
            guard configuredPublishableKey == publishableKey else {
                Self.logger.error("initialize rejected a different Clerk environment key")
                call.reject("Clerk was already initialized with a different environment key.")
                return
            }
            Self.logger.info("Clerk is already configured; reading current auth state")
            let state = await authStatePayload()
            call.resolve(state)
            Self.logger.info("initialize resolved using the existing Clerk configuration")
            return
        }

        let options = Clerk.Options(
            redirectConfig: .init(
                redirectUrl: Self.redirectURL,
                callbackUrlScheme: Self.callbackScheme
            )
        )
        Self.logger.info("Calling Clerk.configure")
        Clerk.configure(publishableKey: publishableKey, options: options)
        configuredPublishableKey = publishableKey
        Self.logger.info("Clerk.configure returned; reading current auth state")

        let state = await authStatePayload()
        call.resolve(state)
        Self.logger.info("initialize resolved")
    }

    @MainActor
    private func getAuthStateOnMainActor(_ call: CAPPluginCall) async {
        Self.logger.info("getAuthState entered MainActor")
        guard ensureConfigured(call) else { return }
        let state = await authStatePayload()
        call.resolve(state)
        Self.logger.info("getAuthState resolved")
    }

    @MainActor
    private func startHostedAuthOnMainActor(_ call: CAPPluginCall) async {
        let mode = call.getString("mode") ?? "signIn"
        Self.logger.info("startHostedAuth entered MainActor; mode=\(mode, privacy: .public)")
        guard ensureConfigured(call) else { return }

        do {
            if mode == "signUp" {
                try await Clerk.shared.auth.startHostedAuth(mode: .signUp)
            } else {
                try await Clerk.shared.auth.startHostedAuth()
            }
            Self.logger.info("Clerk hosted auth returned; reading current auth state")
            let state = await authStatePayload()
            call.resolve(state)
            Self.logger.info("startHostedAuth resolved")
        } catch {
            Self.logger.error("startHostedAuth rejected: \(error.localizedDescription, privacy: .public)")
            call.reject(error.localizedDescription)
        }
    }

    @MainActor
    private func getTokenOnMainActor(_ call: CAPPluginCall) async {
        Self.logger.info("getToken entered MainActor")
        guard ensureConfigured(call) else { return }

        do {
            let token = try await Clerk.shared.auth.getToken()
            call.resolve(["token": token as Any? ?? NSNull()])
            Self.logger.info("getToken resolved")
        } catch {
            Self.logger.error("getToken rejected: \(error.localizedDescription, privacy: .public)")
            call.reject(error.localizedDescription)
        }
    }

    @MainActor
    private func signOutOnMainActor(_ call: CAPPluginCall) async {
        Self.logger.info("signOut entered MainActor")
        guard ensureConfigured(call) else { return }

        do {
            try await Clerk.shared.auth.signOut()
            let state = await authStatePayload()
            call.resolve(state)
            Self.logger.info("signOut resolved")
        } catch {
            Self.logger.error("signOut rejected: \(error.localizedDescription, privacy: .public)")
            call.reject(error.localizedDescription)
        }
    }

    @MainActor
    private func ensureConfigured(_ call: CAPPluginCall) -> Bool {
        guard configuredPublishableKey != nil else {
            Self.logger.error("Plugin method rejected because Clerk is not configured")
            call.reject("Clerk native authentication has not been initialized.")
            return false
        }
        return true
    }

    @MainActor
    private func authStatePayload() async -> [String: Any] {
        Self.logger.info("Reading Clerk user state")
        let clerk = Clerk.shared
        guard let user = clerk.user else {
            Self.logger.info("Clerk reports a signed-out session")
            return ["isSignedIn": false, "user": NSNull()]
        }

        let emails = user.emailAddresses.map { ["emailAddress": $0.emailAddress] }
        let primaryEmail = user.primaryEmailAddress?.emailAddress
        let fullName = [user.firstName, user.lastName]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")

        Self.logger.info("Clerk reports a signed-in session")
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
