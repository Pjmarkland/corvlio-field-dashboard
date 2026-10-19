import {beforeEach,describe,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({platform:'ios',get:vi.fn()}));
vi.mock('@capacitor/core',()=>({
  Capacitor:{getPlatform:()=>m.platform},
  registerPlugin:()=>({getEnvironment:m.get}),
}));
import {iosPushEnvironment} from './pushEnvironment';
beforeEach(()=>{m.platform='ios';m.get.mockReset();});
describe('native build push environment',()=>{
  it.each(['sandbox','production'])('uses the native %s result without a web-build fallback',async environment=>{
    m.get.mockResolvedValue({environment});expect(await iosPushEnvironment()).toBe(environment);
  });
  it('does not guess when the native plugin is unavailable or returns an invalid environment',async()=>{
    m.get.mockRejectedValueOnce(new Error('Rebuild native app'));
    await expect(iosPushEnvironment()).rejects.toThrow('Rebuild native app');
    m.get.mockResolvedValue({environment:'unknown'});
    await expect(iosPushEnvironment()).rejects.toThrow('could not be verified');
  });
  it('does not call the iOS plugin on Android/web',async()=>{
    m.platform='android';expect(await iosPushEnvironment()).toBeUndefined();expect(m.get).not.toHaveBeenCalled();
  });
});
