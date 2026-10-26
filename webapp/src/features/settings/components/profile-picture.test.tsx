import type { AuthUser } from '@coretask/types';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/auth.store';
import { renderWithProviders, screen, setupUser, waitFor } from '@/test/test-utils';

import { ProfilePicture } from './profile-picture';

const createAvatarUpload = vi.fn();
const confirmAvatarUpload = vi.fn();
const removeAvatar = vi.fn();
const uploadPicture = vi.fn();
const squarePicture = vi.fn();

vi.mock('../api/account.api', () => ({
  accountApi: {
    createAvatarUpload: (...args: unknown[]) => createAvatarUpload(...args),
    confirmAvatarUpload: (...args: unknown[]) => confirmAvatarUpload(...args),
    removeAvatar: (...args: unknown[]) => removeAvatar(...args),
  },
  uploadPicture: (...args: unknown[]) => uploadPicture(...args),
}));

// jsdom has no canvas to crop with; what the crop hands back is what matters.
vi.mock('../lib/square-picture', () => ({
  squarePicture: (...args: unknown[]) => squarePicture(...args),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const account: AuthUser = {
  id: 'u-1',
  email: 'bea@example.com',
  name: 'Bea Lin',
  avatarUrl: null,
  timezone: 'UTC',
  emailVerified: true,
  emailVerificationDueAt: null,
  hasPassword: true,
  twoFactorEnabled: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  pronouns: null,
  jobTitle: null,
  department: null,
  aboutMe: null,
  outOfOffice: null,
};

const PICTURE_URL = 'http://localhost:3000/api/v1/users/u-1/avatar?v=0192abcd';
const upload = {
  uploadUrl: 'http://storage.test/avatars/u-1/x.webp?X-Amz-Signature=sig',
  headers: { 'Content-Type': 'image/webp' },
  expiresInSeconds: 300,
  uploadToken: 'sealed-token',
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ status: 'authenticated', user: account });
});

describe('ProfilePicture', () => {
  it('crops, uploads and confirms the chosen picture, then shows it as the account’s', async () => {
    const square = new Blob(['webp bytes'], { type: 'image/webp' });
    squarePicture.mockResolvedValue(square);
    createAvatarUpload.mockResolvedValue(upload);
    uploadPicture.mockResolvedValue(undefined);
    confirmAvatarUpload.mockResolvedValue({ ...account, avatarUrl: PICTURE_URL });
    renderWithProviders(<ProfilePicture user={account} />);
    const user = setupUser();

    expect(screen.queryByRole('button', { name: /remove picture/i })).not.toBeInTheDocument();
    const photo = new File(['a big photo'], 'holiday.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText('Choose a profile picture'), photo);

    await waitFor(() => expect(confirmAvatarUpload).toHaveBeenCalledWith('sealed-token'));
    expect(squarePicture).toHaveBeenCalledWith(photo);
    // The declaration describes the cropped picture, not the original.
    expect(createAvatarUpload).toHaveBeenCalledWith({
      mimeType: 'image/webp',
      sizeBytes: square.size,
    });
    expect(uploadPicture).toHaveBeenCalledWith(upload, square);
    expect(useAuthStore.getState().user?.avatarUrl).toBe(PICTURE_URL);
    expect(toast.success).toHaveBeenCalledWith('Picture updated.');
  });

  it('does not confirm a picture that never reached storage, and says so', async () => {
    squarePicture.mockResolvedValue(new Blob(['webp'], { type: 'image/webp' }));
    createAvatarUpload.mockResolvedValue(upload);
    uploadPicture.mockRejectedValue(new Error('The picture did not upload. Try again.'));
    renderWithProviders(<ProfilePicture user={account} />);
    const user = setupUser();

    await user.upload(
      screen.getByLabelText('Choose a profile picture'),
      new File(['x'], 'me.png', { type: 'image/png' }),
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('The picture did not upload. Try again.'),
    );
    expect(confirmAvatarUpload).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user?.avatarUrl).toBeNull();
  });

  it('removes the picture', async () => {
    const withPicture = { ...account, avatarUrl: PICTURE_URL };
    useAuthStore.setState({ user: withPicture });
    removeAvatar.mockResolvedValue({ ...account, avatarUrl: null });
    renderWithProviders(<ProfilePicture user={withPicture} />);
    const user = setupUser();

    expect(screen.getByRole('button', { name: /change picture/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /remove picture/i }));

    await waitFor(() => expect(useAuthStore.getState().user?.avatarUrl).toBeNull());
    expect(removeAvatar).toHaveBeenCalled();
  });
});
