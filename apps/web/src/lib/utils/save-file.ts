/** Save a downloaded file under its name, as a link with `download` would. */
export function saveFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // The browser has the file once the click is handled; free the memory a little later.
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
