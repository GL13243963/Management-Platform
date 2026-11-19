INSERT OR IGNORE INTO comp_leave_records (employeeId, date, note, createdAt)
  SELECT employeeId, date, overrideNote, createdAt FROM attendance_logs
  WHERE overrideType='comp_leave';

DELETE FROM attendance_logs
  WHERE overrideType='comp_leave' AND rawClockIn IS NULL AND rawClockOut IS NULL;

UPDATE attendance_logs SET overrideType=NULL, overrideNote=NULL,
    clockIn=rawClockIn, clockOut=rawClockOut,
    workHours=CASE
      WHEN rawClockIn IS NOT NULL AND rawClockOut IS NOT NULL THEN
        MAX(0, (CAST(substr(rawClockOut,1,2) AS INTEGER)*60 + CAST(substr(rawClockOut,4,2) AS INTEGER)
          - CAST(substr(rawClockIn,1,2) AS INTEGER)*60 - CAST(substr(rawClockIn,4,2) AS INTEGER)) / 60.0)
      ELSE 0 END
  WHERE overrideType='comp_leave';

UPDATE attendance_logs SET isMissedPunch=1
  WHERE status IN ('missed_punch', 'absent') AND isMissedPunch=0;

UPDATE attendance_logs SET missedPunchCount=
    (CASE WHEN COALESCE(rawClockIn,'') GLOB '*漏刷*' OR COALESCE(rawClockIn,'') GLOB '*漏卡*'
      OR COALESCE(rawClockIn,'') GLOB '*缺卡*' OR COALESCE(rawClockIn,'') GLOB '*未打卡*' THEN 1 ELSE 0 END) +
    (CASE WHEN COALESCE(rawClockOut,'') GLOB '*漏刷*' OR COALESCE(rawClockOut,'') GLOB '*漏卡*'
      OR COALESCE(rawClockOut,'') GLOB '*缺卡*' OR COALESCE(rawClockOut,'') GLOB '*未打卡*' THEN 1 ELSE 0 END)
  WHERE missedPunchCount=0;

UPDATE attendance_logs SET workHours=4
  WHERE isMissedPunch=1 AND overrideType IS NULL
    AND ((clockIn IS NOT NULL AND clockOut IS NULL)
      OR (clockIn IS NULL AND clockOut IS NOT NULL));

UPDATE attendance_logs SET sourceOvertime=1,
    sourceOvertimeHours=CASE WHEN sourceOvertimeHours=0 THEN MAX(0, workHours-8) ELSE sourceOvertimeHours END
  WHERE (coalesce(rawClockIn,'') || coalesce(rawClockOut,'')) LIKE '%加班%';
  UPDATE attendance_logs SET sourceBusinessTrip=1,
    sourceBusinessTripHours=CASE WHEN sourceBusinessTripHours=0 THEN workHours ELSE sourceBusinessTripHours END
  WHERE (coalesce(rawClockIn,'') || coalesce(rawClockOut,'')) LIKE '%出差%';
  UPDATE attendance_logs SET sourceOutside=1,
    sourceOutsideHours=CASE WHEN sourceOutsideHours=0 THEN workHours ELSE sourceOutsideHours END
  WHERE (coalesce(rawClockIn,'') || coalesce(rawClockOut,'')) LIKE '%外出%';

UPDATE attendance_logs SET status='excluded', workHours=CASE
    WHEN (COALESCE(rawClockIn,'') || ' ' || COALESCE(rawClockOut,'')) GLOB '*外出*' THEN
      CASE
        WHEN COALESCE(sourceOutsideHours,0)>0 THEN sourceOutsideHours
        WHEN clockIn IS NOT NULL AND clockOut IS NOT NULL THEN
          MAX(0, (CAST(substr(clockOut,1,2) AS INTEGER)*60 + CAST(substr(clockOut,4,2) AS INTEGER)
            - CAST(substr(clockIn,1,2) AS INTEGER)*60 - CAST(substr(clockIn,4,2) AS INTEGER)) / 60.0)
        ELSE 0 END
    ELSE 0 END,
  isLate=0, isEarlyLeave=0, isMissedPunch=0, missedPunchCount=0
  WHERE (COALESCE(rawClockIn,'') || ' ' || COALESCE(rawClockOut,''))
    GLOB '*年假*' OR (COALESCE(rawClockIn,'') || ' ' || COALESCE(rawClockOut,'')) GLOB '*事假*'
    OR (COALESCE(rawClockIn,'') || ' ' || COALESCE(rawClockOut,'')) GLOB '*病假*'
    OR (COALESCE(rawClockIn,'') || ' ' || COALESCE(rawClockOut,'')) GLOB '*婚假*'
    OR (COALESCE(rawClockIn,'') || ' ' || COALESCE(rawClockOut,'')) GLOB '*产假*'
    OR (COALESCE(rawClockIn,'') || ' ' || COALESCE(rawClockOut,'')) GLOB '*丧假*'
    OR (COALESCE(rawClockIn,'') || ' ' || COALESCE(rawClockOut,'')) GLOB '*请假*'
    OR (COALESCE(rawClockIn,'') || ' ' || COALESCE(rawClockOut,'')) GLOB '*外出*'
    OR (COALESCE(rawClockIn,'') || ' ' || COALESCE(rawClockOut,'')) GLOB '*调休*';

UPDATE attendance_logs SET
    isMissedPunch=CASE WHEN missedPunchCount>0 THEN 1 ELSE 0 END,
    isLate=CASE WHEN (COALESCE(rawClockIn,'') || ' ' || COALESCE(rawClockOut,'')) GLOB '*迟到*' THEN 1 ELSE 0 END,
    isEarlyLeave=CASE WHEN (COALESCE(rawClockIn,'') || ' ' || COALESCE(rawClockOut,'')) GLOB '*早退*' THEN 1 ELSE 0 END
  WHERE source='import' AND overrideType IS NULL;

  UPDATE attendance_logs SET status=CASE
    WHEN status='excluded' THEN 'excluded'
    WHEN isMissedPunch=1 THEN 'missed_punch'
    WHEN sourceBusinessTrip=1 AND clockIn IS NULL AND clockOut IS NULL THEN 'business_trip'
    WHEN sourceOvertime=1 AND clockIn IS NULL AND clockOut IS NULL THEN 'overtime'
    WHEN isLate=1 AND isEarlyLeave=1 THEN 'late_and_early'
    WHEN isLate=1 THEN 'late'
    WHEN isEarlyLeave=1 THEN 'early'
    ELSE 'normal' END
  WHERE source='import' AND overrideType IS NULL;
