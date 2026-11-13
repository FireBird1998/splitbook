/** One off-by-default product switch, also available to the web settings entry. */
export function headerScenesEnabled(): boolean {
  return process.env.NEXT_PUBLIC_HEADER_SCENES_ENABLED === 'true';
}
