/**
 * Settings → Your data: "Download a copy of everything" as an Excel file.
 */

import { ApiService } from '../services/api.js';
import { Toast } from '../components/toast.js';

export const DATA_EXPORT_ACTIONS = ['downloadEverything'];

export const dataExportMethods = {
  async downloadEverything(_id, btn) {
    const label = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Preparing your file...';
    }
    try {
      const { blob, filename } = await ApiService.downloadEverything();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      Toast.success(`Your copy has been downloaded: ${filename}. It opens in Excel.`);
    } catch (err) {
      Toast.error(err.message || 'Sloane could not make the file just now. Please try again.');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = label;
      }
    }
  }
};
