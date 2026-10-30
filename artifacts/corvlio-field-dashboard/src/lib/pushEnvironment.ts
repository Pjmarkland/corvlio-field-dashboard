import { Capacitor, registerPlugin } from '@capacitor/core';
const native = registerPlugin<{getEnvironment():Promise<{environment:'sandbox'|'production'}>}>('PushEnvironment');
export async function iosPushEnvironment() {
  if (Capacitor.getPlatform() !== 'ios') return undefined;
  const result=await native.getEnvironment();
  if (!['sandbox','production'].includes(result.environment)) throw new Error('The native push environment could not be verified.');
  return result.environment;
}
