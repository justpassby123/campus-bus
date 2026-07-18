# 南审校园公交系统

## 一键启动 (最简单)

1. **首次使用：先装 Node.js**
   - 下载: https://nodejs.org/
   - 选 LTS (左边的绿色按钮), 双击安装, 一路"下一步"
   - 装完关掉所有窗口, 重启电脑 (有时候需要)

2. **启动后端**
   - 打开 `campus-bus` 文件夹
   - **双击 `启动.bat`**
   - 看到 `🚌 已启动` 字样就成功了
   - **不要关掉弹出的黑色窗口** (关掉 = 服务停了)

3. **打开页面**
   - 浏览器 (推荐 Chrome / Edge) 打开:
     - 学生端: http://localhost:3000/student.html
     - 司机端: http://localhost:3000/driver.html
   - 想要两台设备同时看: 用两台手机/电脑都连同一个WiFi, 把 `localhost` 换成电脑的 IP (启动窗口会显示)

## 手动启动 (会命令行的人用)

```bash
cd campus-bus
npm install   # 只在第一次运行
node server.js
```

## 常见问题

### Q: 双击 `启动.bat` 闪退 / 一闪而过
A: 大概率没装 Node.js. 检查方法: 按 `Win+R` 输入 `cmd`, 回车, 输 `node -v`, 看有没有版本号. 没有就装 Node.js.

### Q: 端口 3000 被占用
A: 黑色窗口里如果有 `EADDRINUSE` 报错, 说明 3000 端口被别的程序占了.
- 找到占用 3000 的程序关掉, 或者
- 编辑 `server.js` 最后一行, 把 `3000` 改成 `3001`, 浏览器也用 3001

### Q: 浏览器打开显示"网络错误"
A: 检查黑色窗口还在不在 (后端服务是否在跑). 如果在跑还报错, 进页面底部"我的" → "修改服务器地址", 确认地址是 `http://localhost:3000` (不能多空格, 不能少 http://).

### Q: 队员怎么访问我的电脑?
A: 让队员也装 Node.js + 下载这套代码, 在他们自己电脑上启动. 他们的 `localhost:3000` 跟你的不一样.
或者用 `ngrok http 3000` 把你的服务暴露成公网 URL (需要装 ngrok).

## 文件结构

```
campus-bus/
├── 启动.bat         ← 双击这个
├── server.js        ← 后端主程序
├── package.json     ← 依赖配置
├── node_modules/    ← 依赖 (自动生成)
├── public/
│   ├── student.html ← 学生端
│   ├── driver.html  ← 司机端
│   ├── css/style.css
│   └── js/
│       ├── common.js
│       ├── student.js
│       └── driver.js
```

## 测试账号

无需登录, 打开即用.
