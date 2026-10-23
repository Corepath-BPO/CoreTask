/**
 * Leaves the app for another page — an identity provider, by way of the
 * API. A full navigation, not the router's: the provider's page is not ours,
 * and the cookie the API sets on the way must travel with a real request.
 * Its own module so a test can stand in for the browser leaving.
 */
export function leaveFor(url: string): void {
  window.location.assign(url);
}
