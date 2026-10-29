import * as LZString from 'lz-string';

/**
 * Compresses a YAML string and appends it as a URL parameter.
 *
 * @param yaml - The YAML string to be compressed and encoded.
 * @returns A URL with the compressed YAML string as a `pricing` parameter.
 */
export function parseStringYamlToEncodedYaml(yaml: string): string {
  // Compresses the YAML string and encodes it to be URL-safe
  const compressed = LZString.compressToEncodedURIComponent(yaml);
  // Returns the current URL with the compressed YAML appended as a query parameter
  return compressed;
}

/**
 * The share link for an encoded pricing (or a short-link key): the current page
 * with `?pricing=` as its only parameter. The current fragment is never copied,
 * so a pricing opened through `#pricing=` cannot leak into a share link.
 */
export function createUrlWithEncodedYaml(encoded: string): string {
  const baseUrl = `${window.location.origin}${window.location.pathname}`;
  return `${baseUrl}?pricing=${encoded}`;
}

/**
 * Decodes a URL-safe compressed YAML string back into its original form.
 *
 * @param encodedYaml - The encoded YAML string to be decompressed and decoded.
 * @returns The original YAML string. If decompression fails, redirects to the base URL.
 */
export function parseEncodedYamlToStringYaml(encodedYaml: string): string {
  // Decompresses and decodes the URL-encoded YAML string
  const original = LZString.decompressFromEncodedURIComponent(encodedYaml);
  // If decompression fails, redirects to the base URL (without parameters)
  if (original === null) {
    window.location.href = window.location.href.split('?')[0];
  }
  return original;
}

/**
 * Initiates the download of a YAML file with a specified filename derived from the YAML content.
 *
 * @param yaml - The YAML content to be saved as a file.
 * @throws Error if the YAML content does not contain a 'saasName' field for naming the file.
 */
export function downloadYaml(yaml: string) {
  // Creates a new Blob for the YAML content
  const blob = new Blob([yaml], { type: 'text/yaml' });
  // Generates a URL for the Blob
  const url = URL.createObjectURL(blob);

  // Attempts to extract the 'saasName' field from the YAML content for use as the file name
  let fileName = yaml.split('\n')[0];
  if (!fileName || !fileName.includes("saasName")) {
    throw new Error('No saasName found in the YAML');
  }
  fileName = fileName.split('saasName:')[1].trim();

  // Creates a temporary link element to trigger the download
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName + ".yml";
  document.body.appendChild(a);
  a.click();

  // Cleans up by revoking the Blob URL and removing the link element
  URL.revokeObjectURL(url);
  document.body.removeChild(a);
}
