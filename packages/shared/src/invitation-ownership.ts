export function invitationEmailMatches(invitedEmail: string, userEmail: string): boolean {
  return invitedEmail.toLowerCase() === userEmail.toLowerCase();
}
