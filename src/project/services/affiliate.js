// "Де зупинитися / Як дістатися" links for a story destination. Partner IDs come from admin
// settings; without them plain search links are used.
const settings = require('../../core/settings');

async function linksFor({ place, country, lat, lng }) {
  const a = (await settings.get('affiliate')) || {};
  const where = [place, country].filter(Boolean).join(', ');
  const q = encodeURIComponent(where);
  const booking = new URL('https://www.booking.com/searchresults.html');
  booking.searchParams.set('ss', where);
  if (a.bookingAid) booking.searchParams.set('aid', a.bookingAid);

  const hotelsMap = lat && lng ? `https://www.google.com/maps/search/hotels/@${lat},${lng},12z` : `https://www.google.com/maps/search/hotels+${q}`;

  const flights = new URL('https://www.skyscanner.net/transport/flights-to/');
  let flightsUrl = `https://www.google.com/travel/flights?q=${encodeURIComponent('flights to ' + where)}`;
  if (a.skyscannerAssociateId) {
    flights.searchParams.set('associateid', a.skyscannerAssociateId);
    flightsUrl = `https://www.skyscanner.net/g/referrals/v1/flights/search?destination=${q}&associateid=${encodeURIComponent(a.skyscannerAssociateId)}`;
  }
  const trains = `https://www.omio.com/search?destination=${q}`;
  const things = a.tripadvisorPartnerId
    ? `https://www.tripadvisor.com/Search?q=${q}&pid=${encodeURIComponent(a.tripadvisorPartnerId)}`
    : `https://www.tripadvisor.com/Search?q=${q}`;
  const directions = lat && lng ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` : `https://www.google.com/maps/dir/?api=1&destination=${q}`;

  return {
    stay: [
      { key: 'booking', url: booking.toString(), partner: Boolean(a.bookingAid) },
      { key: 'hotelsMap', url: hotelsMap, partner: false },
    ],
    go: [
      { key: 'flights', url: flightsUrl, partner: Boolean(a.skyscannerAssociateId) },
      { key: 'trains', url: trains, partner: false },
      { key: 'directions', url: directions, partner: false },
      { key: 'things', url: things, partner: Boolean(a.tripadvisorPartnerId) },
    ],
  };
}

module.exports = { linksFor };
