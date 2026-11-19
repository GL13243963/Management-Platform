// Fixed same-origin platform routes; never accept redirect URLs from query strings.
export function platformPath(reason='home') {
  return {legacy:'/#/tool-matrix?view=legacy',home:'/#/os',login:'/#/login',password:'/#/change-password'}[reason] || '/#/os';
}
export function returnToOs(reason='home') { window.location.assign(platformPath(reason)); }
export function identityFailure(error) {
  if(error?.httpStatus===401) return 'login';
  if(error?.code==='PASSWORD_CHANGE_REQUIRED') return 'password';
  return null;
}
