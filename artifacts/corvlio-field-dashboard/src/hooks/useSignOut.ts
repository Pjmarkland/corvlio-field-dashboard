import { useState } from 'react';
import { useClerk } from '@clerk/react';
import { useToast } from '@/hooks/use-toast';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function useSignOut(revoke: () => Promise<void>) {
  const { signOut } = useClerk();
  const { toast } = useToast();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await revoke();
    } catch {
      setIsSigningOut(false);
      toast({
        variant: 'destructive',
        title: 'Could not disable push alerts',
        description:
          'Alerts may still arrive on this device. Please tap Retry on the Push alerts row, then sign out again.',
      });
      return;
    }
    try {
      await signOut();
      window.location.assign(basePath || '/');
    } catch (error) {
      setIsSigningOut(false);
      toast({
        variant: 'destructive',
        title: 'Could not sign out',
        description: error instanceof Error && error.message
          ? error.message
          : 'Clerk could not finish signing you out. Please try again.',
      });
    }
  };

  return { handleSignOut, isSigningOut };
}