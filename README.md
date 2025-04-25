# Microsoft 365 Webhook Demo

这是一个用于测试 Microsoft 365 webhook 功能的演示项目，主要测试邮件接收和 Teams 聊天通知的 webhook 功能。

## 功能特点

- 接收和处理 Microsoft 365 邮件通知
- 接收和处理 Teams 聊天消息通知
- 支持 webhook 订阅验证
- 使用 Microsoft Graph API 进行身份验证和数据处理

## 前提条件

- Node.js (v14 或更高版本)
- Microsoft 365 开发者账号
- 在 Azure Portal 中注册的应用程序
- 可公开访问的 webhook URL（可以使用 ngrok 进行本地测试）

## 安装步骤

1. 克隆项目并安装依赖：
   ```bash
   npm install
   ```

2. 创建 `.env` 文件并配置以下环境变量：
   ```
   CLIENT_ID=your_client_id
   CLIENT_SECRET=your_client_secret
   TENANT_ID=your_tenant_id
   WEBHOOK_URL=your_webhook_url
   SUBSCRIPTION_SECRET=your_subscription_secret
   PORT=3000
   ```

3. 启动服务器：
   ```bash
   npm start
   ```

## 配置 Microsoft 365 订阅

1. 在 Azure Portal 中注册应用程序并获取必要的凭据
2. 配置应用程序权限：
   - Mail.Read
   - Chat.Read
   - ChannelMessage.Read.All

3. 使用 Microsoft Graph API 创建订阅：
   ```javascript
   // 邮件订阅
   POST https://graph.microsoft.com/v1.0/subscriptions
   Content-Type: application/json

   {
     "changeType": "created,updated",
     "notificationUrl": "your_webhook_url",
     "resource": "/me/messages",
     "expirationDateTime": "2024-03-20T18:23:45.9356913Z",
     "clientState": "your_subscription_secret"
   }

   // Teams 聊天订阅
   POST https://graph.microsoft.com/v1.0/subscriptions
   Content-Type: application/json

   {
     "changeType": "created,updated",
     "notificationUrl": "your_webhook_url",
     "resource": "/me/chats",
     "expirationDateTime": "2024-03-20T18:23:45.9356913Z",
     "clientState": "your_subscription_secret"
   }
   ```

## 本地测试

1. 使用 ngrok 创建临时公共 URL：
   ```bash
   ngrok http 3000
   ```

2. 将 ngrok 提供的 URL 更新到 `.env` 文件中的 `WEBHOOK_URL`

## 注意事项

- 确保 webhook URL 是 HTTPS
- 订阅默认有效期为 3 天
- 需要定期续订订阅
- 建议在生产环境中添加更多的安全措施

## 故障排除

如果遇到问题，请检查：
1. 环境变量是否正确配置
2. 应用程序权限是否正确设置
3. webhook URL 是否可公开访问
4. 订阅是否已过期

## 许可证

MIT 