import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useAuthStore } from '@/stores/auth.store';

import { authApi } from '../api/auth.api';

/**
 * "Send confirmation link". The server sends nothing when the address is already
 * confirmed or a link went out under a minute ago, and says which — so the
 * toast tells the person what actually happened rather than always "sent".
 */
export function useResendVerification() {
  return useMutation({
    mutationFn: () => authApi.resendVerification(),
    onSuccess: (result) => {
      const { user, setUser } = useAuthStore.getState();

      if (result.emailVerified) {
        if (user && !user.emailVerified) setUser({ ...user, emailVerified: true });
        toast.success('Your e-mail address is already confirmed.');
        return;
      }

      toast.success(
        result.sent
          ? `We sent a confirmation link to ${user?.email ?? 'your address'}.`
          : 'A link went out less than a minute ago. Check your inbox.',
      );
    },
    onError: () => toast.error('Could not send a new link. Try again in a moment.'),
  });
}
