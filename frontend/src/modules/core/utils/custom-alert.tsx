import { createRoot } from 'react-dom/client';
import AlertModal from '../components/alert-modal';
import type { Severity } from '../components/alert-modal';

function customAlert(message: string, severity: Severity = 'info'): Promise<void> {
  return new Promise((resolve) => {
    const containerId = 'alert';
    let container = document.getElementById(containerId);
    if (!container) {
      container = document.createElement('div');
      container.id = containerId;
      document.body.appendChild(container);
    }
    const root = createRoot(container);

    const cleanup = () => {
      root.unmount();
    };

    const handleClose = () => {
      cleanup();
      resolve();
    };

    root.render(<AlertModal message={message} severity={severity} onClose={handleClose} />);
  });
}

export default customAlert;
