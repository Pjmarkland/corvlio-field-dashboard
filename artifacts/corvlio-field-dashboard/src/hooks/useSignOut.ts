import { useState } from 'react';
import { useAppAuth } from '@/auth/AppAuthProvider';
import { useToast } from '@/hooks/use-toast';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
type PublicRootNavigator = (path: string) => void;

const navigateToPublicRoot: PublicRootNavigator = (path) => {
  window.location.assign(path);
};

export function useSignOut(
  revoke: () => Promise<void>,
  navigate: PublicRootNavigator = navigateToPublicRoot,
) {
  const { signOut } = useAppAuth();
  const { toast } = useToast();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await revoke();
    } catch {
      // Push registration cleanup is best-effort; it must never trap a user here.
      console.warn('Push alert unregister failed during sign-out; continuing to sign out.');
    }
    try {
      await signOut();
      navigate(basePath || '/');
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