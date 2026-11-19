const shanghaiDistrict = /^(?:黄浦|徐汇|长宁|静安|普陀|虹口|杨浦|闵行|宝山|嘉定|金山|松江|青浦|奉贤|崇明)区(?=[|｜\s]|$)|^浦东新区(?=[|｜\s]|$)/;
const timestamp = /^(?:(?:20\d{2}[-/年])?\d{1,2}[-/月]\d{1,2}日?\s+)?\d{1,2}:\d{2}(?::\d{2})?(?:\s*周[一二三四五六日天])?(?=\s|$)\s*/;

function cleanAddress(value) {
  let text = String(value || '').trim();
  while (timestamp.test(text)) text = text.replace(timestamp, '').trim();
  return text;
}

function shortAddress(value) {
  return value.split(/[|｜]/).at(-1).trim()
    .replace(/^(上海市|北京市|天津市|重庆市)/, '')
    .replace(/^.*(?:有限责任公司|有限公司)\s*[(（]([^()（）]+)[)）]$/, '$1')
    .replace(/(?:有限责任公司|有限公司)/g, '')
    .replace(/[（(]([^()（）]+)[）)]$/, '$1');
}

export function normalizeTrip(trip) {
  const origin = cleanAddress(trip.origin);
  const destination = cleanAddress(trip.destination);
  const districtCity = address => shanghaiDistrict.test(address) ? '上海市' : '';
  return {
    ...trip, origin, destination,
    originCity: trip.originCity || districtCity(origin),
    destinationCity: trip.destinationCity || districtCity(destination),
  };
}

export function summarizeTripRemark(trips, maxLength = 60) {
  const segments = trips.filter(trip => trip.origin && trip.destination && trip.date && trip.time)
    .map(trip => ({
      time: trip.date.slice(5).replace('-', '/') + ' ' + trip.time,
      origin: shortAddress(trip.origin) || trip.origin,
      destination: shortAddress(trip.destination) || trip.destination,
    }));
  for (let count = segments.length; count > 0; count--) {
    const suffix = count < segments.length ? '；另' + (segments.length - count) + '段' : '';
    for (let limit = maxLength; limit >= 2; limit--) {
      const shorten = place => place.length > limit ? place.slice(0, limit - 1) + '…' : place;
      const remark = segments.slice(0, count).map(segment =>
        segment.time + ' ' + shorten(segment.origin) + '→' + shorten(segment.destination)
      ).join('；') + suffix;
      if (remark.length <= maxLength) return remark;
    }
  }
  return '';
}
