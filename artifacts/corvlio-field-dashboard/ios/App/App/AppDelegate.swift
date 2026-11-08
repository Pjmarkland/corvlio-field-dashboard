import UIKit
import Capacitor
import os

// Native build configuration, not Vite's web build mode, determines the token's
// APNs environment. A TestFlight/App Store Release reports production even when
// pointed at a development API.
@objc(PushEnvironmentPlugin)
public class PushEnvironmentPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PushEnvironmentPlugin"
    public let jsName = "PushEnvironment"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getEnvironment", returnType: CAPPluginReturnPromise)
    ]
    @objc func getEnvironment(_ call: CAPPluginCall) {
        #if DEBUG
        call.resolve(["environment": "sandbox"])
        #else
        call.resolve(["environment": "production"])
        #endif
    }
}

class AppViewController: CAPBridgeViewController {
    private static let logger = Logger(
        subsystem: "com.corvlio.fielddashboard",
        category: "CapacitorBridge"
    )

    override func capacitorDidLoad() {
        guard let bridge else {
            Self.logger.error("Capacitor bridge was unavailable during plugin registration")
            return
        }

        Self.logger.info("Capacitor bridge loaded; registering native plugins")
        bridge.registerPluginInstance(PushEnvironmentPlugin())
        bridge.registerPluginInstance(ClerkNativeAuthPlugin())
        Self.logger.info("ClerkNativeAuth and PushEnvironment plugins registered")
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // MARK: - Push Notifications (required by @capacitor/push-notifications)
    // These two methods forward APNs registration results to Capacitor's push plugin.
    // Without them PushNotifications.register() never resolves on iOS.

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

}
