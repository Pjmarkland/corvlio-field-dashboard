import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {apnsHost,defaultApnsEnvironment} from "../../src/lib/apnsEnvironment";
describe("APNs build/environment boundary",()=>{
  it("defaults deployed servers to production and local development to sandbox",()=>{
    expect(defaultApnsEnvironment({NODE_ENV:"production"})).toBe("production");
    expect(defaultApnsEnvironment({REPLIT_DEPLOYMENT:"1",NODE_ENV:"development"})).toBe("production");
    expect(defaultApnsEnvironment({NODE_ENV:"development"})).toBe("sandbox");
    expect(defaultApnsEnvironment({NODE_ENV:"production",APNS_ENV:"sandbox"})).toBe("sandbox");
    expect(()=>defaultApnsEnvironment({APNS_ENV:"typo"})).toThrow();
    expect(apnsHost("production")).toBe("api.push.apple.com");
    expect(apnsHost("sandbox")).toBe("api.sandbox.push.apple.com");
  });
  it("pairs Debug sandbox and Release production native builds with the correct entitlement",()=>{
    const root=new URL("../../../corvlio-field-dashboard/ios/App/",import.meta.url);
    const project=readFileSync(new URL("App.xcodeproj/project.pbxproj",root),"utf8");
    expect(project).toMatch(/APS_ENVIRONMENT = development;[\s\S]*?name = Debug/);
    expect(project).toMatch(/APS_ENVIRONMENT = production;[\s\S]*?name = Release/);
    expect(project).toContain("PRODUCT_BUNDLE_IDENTIFIER = com.corvlio.fielddashboard");
    const entitlement=readFileSync(new URL("App/App.entitlements",root),"utf8");
    expect(entitlement).toContain("$(APS_ENVIRONMENT)");
    const plugin=readFileSync(new URL("App/AppDelegate.swift",root),"utf8");
    expect(plugin).toMatch(/#if DEBUG[\s\S]*?"sandbox"[\s\S]*?#else[\s\S]*?"production"/);
  });
});
