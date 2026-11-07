const month = new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Brussels',year:'numeric',month:'2-digit'});
export function historyGraceMs(urlLike, now=new Date()) {
  let path;
  try { path = new URL(String(urlLike)).pathname; } catch { return 0; }
  if (!/^\/movies\/(?:(?:collections-only|mobile-desktop-collections|native-bridge(?:\/mobile)?)\/)?catalog\/movie\/movies-fr-(?:all|streaming|vod|cinema)-[^/]+\.json$/.test(path)) return 0;
  const current=month.format(now);
  const oldMonth=path.match(/-(20\d{2})-(0[1-9]|1[0-2])\.json$/);
  if(oldMonth) return (oldMonth[1]+'-'+oldMonth[2])<current ? 180000 : 0;
  const oldYear=path.match(/-annual-(20\d{2})\.json$/);
  return oldYear && Number(oldYear[1])<Number(current.slice(0,4)) ? 180000 : 0;
}
