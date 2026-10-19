export type ApnsEnvironment="production"|"sandbox";
export function defaultApnsEnvironment(env:NodeJS.ProcessEnv=process.env):ApnsEnvironment {
  if (env.APNS_ENV && env.APNS_ENV!=="sandbox" && env.APNS_ENV!=="production")
    throw new Error("APNS_ENV must be production or sandbox.");
  return env.APNS_ENV as ApnsEnvironment | undefined
    ?? (env.REPLIT_DEPLOYMENT || env.NODE_ENV==="production" ? "production" : "sandbox");
}
export function apnsHost(environment:ApnsEnvironment) {
  return environment==="production" ? "api.push.apple.com" : "api.sandbox.push.apple.com";
}
