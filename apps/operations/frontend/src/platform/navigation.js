export function corePath(action='home'){return ({home:'/#/os',login:'/#/login',password:'/#/change-password',accounts:'/#/data?tab=accounts',system:'/#/data?tab=system'})[action]||'/#/os';}
export function returnCore(action='home'){window.location.assign(corePath(action));}
