// 测试 webhook 端点是否可正确响应验证请求
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// 用于动态导入 node-fetch 的辅助函数
async function fetchModule() {
  return (await import('node-fetch')).default;
}

// 确保 .env 文件存在
if (!fs.existsSync('.env')) {
  console.warn('警告: .env 文件不存在，请确保环境变量已正确设置');
}

// 计算正确的webhook端点
const webhookUrl = process.env.WEBHOOK_URL || 'http://localhost:3000';
// 如果URL已经包含/webhook，则不再添加
const endpoint = webhookUrl.endsWith('/webhook') 
  ? webhookUrl 
  : `${webhookUrl}/webhook`;

console.log(`使用webhook端点: ${endpoint}`);

async function testValidation() {
  console.log(`Testing webhook endpoint: ${endpoint}`);
  const fetch = await fetchModule();
  
  // 测试验证请求
  const validationToken = 'TestValidationToken12345';
  const validationUrl = `${endpoint}?validationToken=${encodeURIComponent(validationToken)}`;
  
  console.log(`Sending validation request to: ${validationUrl}`);
  
  try {
    const response = await fetch(validationUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('Response status:', response.status);
    const responseText = await response.text();
    console.log('Response body:', responseText);
    
    if (response.status === 200 && responseText === validationToken) {
      console.log('✅ Validation test PASSED - Endpoint correctly returned the validation token with 200 status');
    } else {
      console.log('❌ Validation test FAILED - Endpoint did not correctly handle the validation request');
      if (response.status !== 200) {
        console.log(`   Expected status 200, got ${response.status}`);
      }
      if (responseText !== validationToken) {
        console.log(`   Expected response body "${validationToken}", got "${responseText}"`);
      }
    }
  } catch (error) {
    console.error('Error during test:', error);
  }
}

// 测试普通通知
async function testNotification() {
  console.log(`\nTesting notification handling at: ${endpoint}`);
  const fetch = await fetchModule();
  
  const testNotification = {
    value: [
      {
        subscriptionId: 'test-subscription-id',
        clientState: process.env.SUBSCRIPTION_SECRET || 'test-secret',
        changeType: 'created',
        resource: '/users/test-user/messages',
        resourceData: {
          '@odata.id': 'test-resource-id',
          '@odata.etag': 'test-etag'
        }
      }
    ]
  };
  
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testNotification)
    });
    
    console.log('Response status:', response.status);
    
    if (response.status === 202) {
      console.log('✅ Notification test PASSED - Endpoint correctly returned 202 status');
    } else {
      console.log('❌ Notification test FAILED - Expected status 202, got', response.status);
    }
  } catch (error) {
    console.error('Error during test:', error);
  }
}

// 运行测试
async function runTests() {
  await testValidation();
  await testNotification();
}

runTests(); 