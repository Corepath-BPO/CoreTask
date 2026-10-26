import { Toaster as Sonner, type ToasterProps } from 'sonner';

import { useTheme } from '@/stores/theme.store';

/**
 * Toast host. Follows the app theme rather than the OS one, so a manual theme
 * override is respected here too.
 */
function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={resolvedTheme}
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: 'group rounded-lg border shadow-lg',
          description: 'text-muted-foreground',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
