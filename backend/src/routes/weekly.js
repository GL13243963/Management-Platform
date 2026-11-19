const express = require('express');
const dayjs = require('dayjs');
const { Employee } = require('../models');
const { requireAnyRole, hasRole, teamLeaderTeams, canViewEmployee } = require('../middleware/auth');
const {
  mondayOf, loadReport, saveReport, previousPlan, listTeamReports,
  pendingProjectReviews, resolveProjectReview,
} = require('../services/weekly-report');
const { summarizeEmployees } = require('../services/analytics');

const router = express.Router();

router.get('/my-attendance-summary', requireAnyRole('employee'), (req, res) => {
  const start = dayjs().subtract(1, 'month').startOf('month');
  const end = start.endOf('month');
  const summary = summarizeEmployees({
    startDate: start.format('YYYY-MM-DD'),
    endDate: end.format('YYYY-MM-DD'),
  }).find(item => item.employeeId === req.auth.user.employeeId) || null;
  const attentionCount = summary
    ? summary.lateDays + summary.earlyDays + summary.missedPunchDays
    : 0;
  let encouragement = '上月考勤数据尚未更新，管理员每月20日更新后，这里会自动显示。';
  if (summary && attentionCount === 0) {
    encouragement = '上月出勤稳定，感谢你的认真投入。新的一月也请保持从容节奏，工作顺利、劳逸有度。';
  } else if (summary && attentionCount <= 2) {
    encouragement = '上月整体表现良好，个别打卡情况请及时留意。愿你新的一月状态饱满、推进顺利。';
  } else if (summary) {
    encouragement = '上月有需要留意的打卡情况，请及时核对。调整好节奏，新的一月继续稳步向前。';
  }
  res.json({
    month: start.format('YYYY年MM月'),
    startDate: start.format('YYYY-MM-DD'),
    endDate: end.format('YYYY-MM-DD'),
    updateDay: 20,
    hasData: !!summary,
    summary,
    encouragement,
  });
});

function requestedWeek(req) {
  return String(req.query.weekStart || req.body?.weekStart || mondayOf(dayjs()));
}

function allowedTeam(req) {
  const requested = String(req.query.team || req.body?.team || '');
  if (hasRole(req.auth.user, 'admin')) return requested || req.auth.user.employee?.team || '方案组';
  const teams = teamLeaderTeams(req.auth.user);
  if (!teams.length || (requested && !teams.includes(requested))) return null;
  return requested || teams[0];
}

router.get('/my', requireAnyRole('employee'), (req, res) => {
  const weekStart = requestedWeek(req);
  const report = loadReport(req.auth.user.employeeId, weekStart);
  res.json({ weekStart, report, suggestedCurrent: report ? [] : previousPlan(req.auth.user.employeeId, weekStart) });
});

router.put('/my', requireAnyRole('employee'), (req, res) => {
  try {
    const report = saveReport({
      employeeId: req.auth.user.employeeId,
      weekStart: requestedWeek(req),
      items: req.body?.items,
      submit: !!req.body?.submit,
      editorUserId: req.auth.user.id,
    });
    req.audit(req.body?.submit ? 'weekly_report_submitted' : 'weekly_report_saved', 'weekly_report', report.id, { weekStart: report.weekStart });
    res.json(report);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/team', requireAnyRole('admin', 'team_leader'), (req, res) => {
  const team = allowedTeam(req);
  if (!team) return res.status(403).json({ error: '不能查看其他小组的个人填报' });
  const weekStart = requestedWeek(req);
  res.json({ team, weekStart, rows: listTeamReports(team, weekStart) });
});

router.put('/team/:employeeId', requireAnyRole('admin', 'team_leader'), (req, res) => {
  const employee = Employee.find(req.params.employeeId);
  if (!canViewEmployee(req.auth.user, employee)) return res.status(403).json({ error: '不能修改其他小组的填报' });
  try {
    const report = saveReport({
      employeeId: employee.id,
      weekStart: requestedWeek(req),
      items: req.body?.items,
      submit: true,
      editorUserId: req.auth.user.id,
      allowLocked: true,
      markReviewed: req.body?.reviewed !== false,
    });
    req.audit('weekly_report_reviewed', 'weekly_report', report.id, { employeeId: employee.id, weekStart: report.weekStart });
    res.json(report);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/project-reviews', requireAnyRole('admin', 'team_leader'), (req, res) => {
  const team = allowedTeam(req);
  if (!team) return res.status(403).json({ error: '不能查看其他小组的名称确认' });
  res.json(pendingProjectReviews(team));
});

router.post('/project-reviews/:id/resolve', requireAnyRole('admin', 'team_leader'), (req, res) => {
  const team = allowedTeam(req);
  if (!team) return res.status(403).json({ error: '不能处理其他小组的名称确认' });
  const review = pendingProjectReviews(team).find(item => item.id === Number(req.params.id));
  if (!review) return res.status(404).json({ error: '待确认记录不存在' });
  try {
    const result = resolveProjectReview({ reviewId: review.id, action: req.body?.action, userId: req.auth.user.id });
    req.audit('project_name_review_resolved', 'project_name_review', review.id, { action: req.body?.action });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
