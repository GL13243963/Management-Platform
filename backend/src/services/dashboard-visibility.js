const HIDDEN_PERSON = '郭磊';

function showOnDashboard(name) {
  return String(name ?? '').trim() !== HIDDEN_PERSON;
}

function dashboardName(name) {
  return showOnDashboard(name) ? name : '';
}

module.exports = { HIDDEN_PERSON, showOnDashboard, dashboardName };
