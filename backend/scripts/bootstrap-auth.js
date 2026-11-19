const path = require('node:path');
const readline = require('node:readline');

const targetPath = path.resolve(process.env.APP_DB_PATH || path.join(__dirname, '..', 'data', 'app.db'));
const resetAll = process.argv.includes('--reset-all');
const leadershipNames = new Set(['曾颖', '郑敦', '王莹']);

function ask(rl, prompt) {
  return new Promise(resolve => rl.question(prompt, answer => resolve(answer.trim())));
}

function askSecret(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('请在可交互终端中运行此命令');
  }
  return new Promise((resolve, reject) => {
    process.stdout.write(prompt);
    let value = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off('data', onData);
    };
    const onData = input => {
      for (const key of input) {
        if (key === '\u0003') {
          cleanup();
          reject(new Error('已取消'));
          return;
        }
        if (key === '\r' || key === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (key === '\u007f' || key === '\b') {
          if (value) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (key >= ' ') {
          value += key;
          process.stdout.write('*');
        }
      }
    };
    process.stdin.on('data', onData);
  });
}

async function main() {
  console.log(resetAll ? '\n即将重置所有现有账号的临时密码。' : '\n即将为现有员工建立登录账号。');
  console.log(`目标数据库：${targetPath}`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const confirmation = await ask(rl, '确认路径无误请输入“确认”：');
  if (confirmation !== '确认') {
    rl.close();
    console.log('已取消，数据库没有改动。');
    return;
  }
  const adminName = await ask(rl, '请输入管理员姓名：');
  rl.close();
  const temporaryPassword = await askSecret('请输入统一临时密码（至少8位，含字母和数字）：');

  const { validatePassword, hashPassword } = require('../src/services/password');
  const validationError = validatePassword(temporaryPassword);
  if (validationError) throw new Error(validationError);
  process.env.APP_DB_PATH = targetPath;
  const { db, Employee } = require('../src/models');
  const { User } = require('../src/models/auth');
  const adminEmployee = Employee.findByName(adminName);
  if (!adminEmployee || !adminEmployee.active) throw new Error('现有员工名单中找不到该管理员');

  Employee.update(adminEmployee.id, { attendanceRequired: false, weeklyReportRequired: false });
  for (const name of leadershipNames) {
    const leaderEmployee = Employee.findByName(name);
    if (leaderEmployee) Employee.update(leaderEmployee.id, {
      personnelVisible: false,
      attendanceRequired: false,
      weeklyReportRequired: false,
    });
  }

  let created = 0;
  let reset = 0;
  for (const employee of Employee.all().filter(item => item.active)) {
    const existing = User.findByUsername(employee.name);
    if (existing) {
      if (resetAll) {
        User.setPassword(existing.id, await hashPassword(temporaryPassword), true);
        require('../src/models/auth').Session.deleteForUser(existing.id);
        reset += 1;
      }
    } else {
      User.create({
        employeeId: employee.id,
        username: employee.name,
        passwordHash: await hashPassword(temporaryPassword),
        roles: leadershipNames.has(employee.name) ? ['leader'] : ['employee'],
      });
      created += 1;
    }
  }
  const admin = User.findByUsername(adminName);
  User.setRoles(admin.id, [
    { role: 'admin' },
    { role: 'team_leader', team: '方案组' },
  ]);
  for (const name of leadershipNames) {
    const leader = User.findByUsername(name);
    if (leader) User.setRoles(leader.id, [{ role: 'leader' }]);
  }
  db.raw.close();
  console.log(`账号初始化完成：新增 ${created} 个账号，重置 ${reset} 个账号。`);
  console.log(`${adminName} 已设置为管理员和方案组长，不参与个人周报及考勤统计。`);
  console.log('所有新账号首次登录后必须修改密码。');
}

main().catch(error => {
  console.error(`初始化失败：${error.message}`);
  process.exitCode = 1;
});
