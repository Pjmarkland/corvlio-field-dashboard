import Capacitor
import ClerkKit
import Foundation

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

    private static let redirectURL = "com.corvlio.fielddashboard://callback"
    private static let callbackScheme = "com.corvlio.fielddashboard"
    private var configuredPublishableKey: String?

    @objc func initialize(_ call: CAPPluginCall) {
        guard let publishableKey = call.getString("publishableKey")?.trimmingCharacters(in: .whitespacesAndNewlines),
              publishableKey.hasPrefix("pk_live_") || publishableKey.hasPrefix("pk_test_") else {
            call.reject("A valid Clerk publishable key is required.")
            return
        }

        if let configuredPublishableKey {
            guard configuredPublishableKey == publishableKey else {
                call.reject("Clerk was already initialized with a different environment key.")
                return
            }
            resolveAuthState(call)
            return
        }

        let options = Clerk.Options(
            redirectConfig: .init(
                redirectUrl: Self.redirectURL,
                callbackUrlScheme: Self.callbackScheme
            )
        )
        Clerk.configure(publishableKey: publishableKey, options: options)
        configuredPublishableKey = publishableKey
        resolveAuthState(call)
    }

    @objc func getAuthState(_ call: CAPPluginCall) {
        guard ensureConfigured(call) else { return }
        resolveAuthState(call)
    }

    @objc func startHostedAuth(_ call: CAPPluginCall) {
        guard ensureConfigured(call) else { return }
        let mode = call.getString("mode") ?? "signIn"

        Task { @MainActor in
            do {
                if mode == "signUp" {
                    try await Clerk.shared.auth.startHostedAuth(mode: .signUp)
                } else {
                    try await Clerk.shared.auth.startHostedAuth()
                }
                call.resolve(await authStatePayload())
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func getToken(_ call: CAPPluginCall) {
        guard ensureConfigured(call) else { return }
        Task { @MainActor in
            do {
                let token = try await Clerk.shared.auth.getToken()
                call.resolve(["token": token as Any? ?? NSNull()])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func signOut(_ call: CAPPluginCall) {
        guard ensureConfigured(call) else { return }
        Task { @MainActor in
            do {
                try await Clerk.shared.auth.signOut()
                call.resolve(await authStatePayload())
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    private func ensureConfigured(_ call: CAPPluginCall) -> Bool {
        guard configuredPublishableKey != nil else {
            call.reject("Clerk native authentication has not been initialized.")
            return false
        }
        return true
    }

    private func resolveAuthState(_ call: CAPPluginCall) {
        Task { @MainActor in
            call.resolve(await authStatePayload())
        }
    }

    @MainActor
    private func authStatePayload() async -> [String: Any] {
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
