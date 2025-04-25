// 订阅管理和通知显示
let eventSource;
let notificationsContainer;
let autoScrollEnabled = true;
let connectionStatus;
let notificationCount = 0;

// 初始化页面
document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const loginButton = document.getElementById('loginButton');
    const logoutButton = document.getElementById('logoutButton');
    const userInfo = document.getElementById('userInfo');
    const emailSubscriptionButton = document.getElementById('emailSubscriptionButton');
    const teamsSubscriptionButton = document.getElementById('teamsSubscriptionButton');
    const clearNotificationsButton = document.getElementById('clearNotificationsButton');
    notificationsContainer = document.getElementById('notifications');
    notificationCount = document.getElementById('notification-count');
    eventsConnectionStatus = document.getElementById('events-connection-status');
    emailSubscriptionStatus = document.getElementById('email-subscription-status');
    teamsSubscriptionStatus = document.getElementById('teams-subscription-status');
    connectionStatus = document.getElementById('connection-status');

    // State variables
    let notificationsCount = 0;
    let userProfile = null;

    // Check authentication status on page load
    checkAuthStatus();

    // Event Listeners
    loginButton.addEventListener('click', login);
    logoutButton.addEventListener('click', logout);
    emailSubscriptionButton.addEventListener('click', () => createSubscription('email'));
    teamsSubscriptionButton.addEventListener('click', () => createSubscription('teams'));
    clearNotificationsButton.addEventListener('click', clearNotifications);

    // 连接到 SSE 事件流
    connectToEventSource();
    
    // 初始化按钮事件监听
    initializeButtons();
    
    // 检查会话状态
    checkSessionStatus();
});

// 连接到服务器事件源
function connectToEventSource() {
    if (eventSource) {
        eventSource.close();
    }
    
    updateConnectionStatus('正在连接...');
    
    eventSource = new EventSource('/api/events');
    
    eventSource.onopen = () => {
        updateConnectionStatus('已连接');
        console.log('SSE 连接已建立');
    };
    
    eventSource.onerror = (error) => {
        updateConnectionStatus('连接失败');
        console.error('SSE 连接错误:', error);
        
        // 5秒后尝试重新连接
        setTimeout(connectToEventSource, 5000);
    };
    
    eventSource.onmessage = (event) => {
        try {
            const notification = JSON.parse(event.data);
            handleNotification(notification);
        } catch (error) {
            console.error('解析通知数据时出错:', error);
            addNotificationCard({
                type: 'error',
                data: {
                    from: '系统',
                    content: `无法解析通知: ${error.message}`,
                    createdDateTime: new Date().toISOString()
                }
            });
        }
    };
}

// 更新连接状态显示
function updateConnectionStatus(status) {
    if (connectionStatus) {
        connectionStatus.textContent = `状态: ${status}`;
        connectionStatus.className = `status-${status.replace(/\s+/g, '-').toLowerCase()}`;
    }
}

// 处理收到的通知
function handleNotification(notification) {
    console.log('收到通知:', notification);
    
    // 增加通知计数
    notificationCount++;
    updateNotificationCount();
    
    // 添加通知卡片
    addNotificationCard(notification);
}

// 更新通知计数
function updateNotificationCount() {
    const countElement = document.getElementById('notification-count');
    if (countElement) {
        countElement.textContent = notificationCount;
    }
}

// 添加通知卡片到容器
function addNotificationCard(notification) {
    if (!notificationsContainer) return;
    
    const card = document.createElement('div');
    card.className = `notification-card ${notification.type}`;
    
    // 创建卡片头部
    const header = document.createElement('div');
    header.className = 'card-header';
    
    // 通知类型和时间
    const typeSpan = document.createElement('span');
    typeSpan.className = 'notification-type';
    typeSpan.textContent = getNotificationTypeText(notification.type);
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'notification-time';
    timeSpan.textContent = formatDateTime(notification.data.createdDateTime);
    
    header.appendChild(typeSpan);
    header.appendChild(timeSpan);
    
    // 创建卡片内容
    const content = document.createElement('div');
    content.className = 'card-content';
    
    // 发件人信息
    const fromDiv = document.createElement('div');
    fromDiv.className = 'notification-from';
    fromDiv.textContent = `发件人: ${notification.data.from || '未知'}`;
    
    // 消息内容
    const messageDiv = document.createElement('div');
    messageDiv.className = 'notification-message';
    
    // 根据不同类型设置内容
    if (notification.type === 'email') {
        messageDiv.innerHTML = `
            <div class="email-subject">${notification.data.subject || '(无主题)'}</div>
            <div class="email-preview">${getContentPreview(notification.data.bodyPreview || notification.data.content)}</div>
        `;
    } else if (notification.type === 'teams') {
        messageDiv.innerHTML = `
            <div class="teams-content">${getContentPreview(notification.data.content)}</div>
        `;
    } else {
        messageDiv.textContent = notification.data.content || '(无内容)';
    }
    
    content.appendChild(fromDiv);
    content.appendChild(messageDiv);
    
    // 添加所有元素到卡片
    card.appendChild(header);
    card.appendChild(content);
    
    // 添加到容器
    notificationsContainer.prepend(card);
    
    // 自动滚动
    if (autoScrollEnabled) {
        notificationsContainer.scrollTop = 0;
    }
}

// 获取通知类型的显示文本
function getNotificationTypeText(type) {
    switch (type) {
        case 'email': return '📧 电子邮件';
        case 'teams': return '💬 Teams 消息';
        case 'error': return '❌ 错误';
        default: return type;
    }
}

// 格式化日期时间
function formatDateTime(dateTimeString) {
    if (!dateTimeString) return '未知时间';
    
    const date = new Date(dateTimeString);
    
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// 获取内容预览，限制长度并处理HTML
function getContentPreview(content) {
    if (!content) return '(无内容)';
    
    // 如果是HTML内容，去除标签
    let plainText = content.replace(/<[^>]*>/g, ' ');
    
    // 如果长度超过150个字符，截断并添加省略号
    if (plainText.length > 150) {
        plainText = plainText.substring(0, 147) + '...';
    }
    
    return plainText;
}

// 初始化按钮事件监听
function initializeButtons() {
    // 订阅邮件按钮
    const subscribeEmailBtn = document.getElementById('subscribe-email');
    if (subscribeEmailBtn) {
        subscribeEmailBtn.addEventListener('click', () => createSubscription('email'));
    }
    
    // 订阅Teams按钮
    const subscribeTeamsBtn = document.getElementById('subscribe-teams');
    if (subscribeTeamsBtn) {
        subscribeTeamsBtn.addEventListener('click', () => createSubscription('teams'));
    }
    
    // 清除通知按钮
    const clearBtn = document.getElementById('clear-notifications');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearNotifications);
    }
    
    // 登录/登出按钮
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', handleLoginLogout);
    }
}

// 创建订阅
async function createSubscription(type) {
    try {
        const response = await fetch(`/api/subscriptions/create?type=${type}`, {
            method: 'POST'
        });
        
        const result = await response.json();
        
        if (response.ok) {
            alert(`成功创建${type === 'email' ? '邮件' : 'Teams'}订阅！\n订阅ID: ${result.id}`);
        } else {
            alert(`创建订阅失败: ${result.error || '未知错误'}`);
        }
    } catch (error) {
        console.error('创建订阅时出错:', error);
        alert(`创建订阅时出错: ${error.message}`);
    }
}

// 清除所有通知
function clearNotifications() {
    if (notificationsContainer) {
        notificationsContainer.innerHTML = '';
        notificationCount = 0;
        updateNotificationCount();
    }
}

// 处理登录/登出
async function handleLoginLogout() {
    const loginBtn = document.getElementById('login-btn');
    
    if (loginBtn.dataset.status === 'logged-in') {
        // 登出
        try {
            await fetch('/auth/logout', { method: 'POST' });
            updateLoginStatus(false);
        } catch (error) {
            console.error('登出失败:', error);
        }
    } else {
        // 登录
        window.location.href = '/auth/login';
    }
}

// 检查会话状态
async function checkSessionStatus() {
    try {
        const response = await fetch('/api/me');
        if (response.ok) {
            const data = await response.json();
            updateLoginStatus(true, data);
        } else {
            updateLoginStatus(false);
        }
    } catch (error) {
        console.error('检查会话状态时出错:', error);
        updateLoginStatus(false);
    }
}

// 更新登录状态
function updateLoginStatus(isLoggedIn, userData = null) {
    const loginBtn = document.getElementById('login-btn');
    const userInfo = document.getElementById('user-info');
    
    if (loginBtn) {
        if (isLoggedIn) {
            loginBtn.textContent = '登出';
            loginBtn.dataset.status = 'logged-in';
        } else {
            loginBtn.textContent = '登录';
            loginBtn.dataset.status = 'logged-out';
        }
    }
    
    if (userInfo) {
        if (isLoggedIn && userData) {
            userInfo.textContent = `用户: ${userData.displayName || userData.username || '已登录用户'}`;
            userInfo.style.display = 'block';
        } else {
            userInfo.style.display = 'none';
        }
    }
    
    // 更新订阅按钮状态
    const subscriptionButtons = document.querySelectorAll('.subscription-btn');
    subscriptionButtons.forEach(btn => {
        btn.disabled = !isLoggedIn;
    });
}

function checkAuthStatus() {
    fetch('/auth/status')
        .then(response => response.json())
        .then(data => {
            if (data.isAuthenticated) {
                userProfile = data.user;
                updateUIForAuthenticatedUser();
                connectToEventStream();
                checkSubscriptionStatus();
            } else {
                updateUIForUnauthenticatedUser();
            }
        })
        .catch(error => {
            console.error('Error checking auth status:', error);
            showNotification('Error checking authentication status', 'error');
        });
}

function updateUIForAuthenticatedUser() {
    loginButton.style.display = 'none';
    logoutButton.style.display = 'inline-block';
    userInfo.innerText = userProfile ? `Hello, ${userProfile.displayName}` : 'Authenticated';
    emailSubscriptionButton.disabled = false;
    teamsSubscriptionButton.disabled = false;
    clearNotificationsButton.disabled = false;
}

function updateUIForUnauthenticatedUser() {
    loginButton.style.display = 'inline-block';
    logoutButton.style.display = 'none';
    userInfo.innerText = 'Not signed in';
    emailSubscriptionButton.disabled = true;
    teamsSubscriptionButton.disabled = true;
    clearNotificationsButton.disabled = true;
    
    if (eventSource) {
        eventSource.close();
        eventSource = null;
        eventsConnectionStatus.innerText = 'Disconnected';
        eventsConnectionStatus.classList.remove('connected');
        connectionStatus.innerText = 'Disconnected';
        connectionStatus.classList.remove('connected');
    }
}

function login() {
    window.location.href = '/auth/login';
}

function logout() {
    fetch('/auth/logout', { method: 'POST' })
        .then(() => {
            userProfile = null;
            updateUIForUnauthenticatedUser();
            showNotification('You have been logged out successfully', 'info');
        })
        .catch(error => {
            console.error('Error during logout:', error);
            showNotification('Error during logout', 'error');
        });
}

function connectToEventStream() {
    if (eventSource) {
        eventSource.close();
    }

    eventSource = new EventSource('/api/events');
    
    eventSource.onopen = () => {
        console.log('SSE connection opened');
        eventsConnectionStatus.innerText = 'Connected';
        eventsConnectionStatus.classList.add('connected');
        connectionStatus.innerText = 'Connected';
        connectionStatus.classList.add('connected');
    };

    eventSource.onmessage = (event) => {
        const notification = JSON.parse(event.data);
        handleNotification(notification);
    };

    eventSource.onerror = (error) => {
        console.error('SSE connection error:', error);
        eventsConnectionStatus.innerText = 'Error';
        eventsConnectionStatus.classList.remove('connected');
        eventsConnectionStatus.classList.add('error');
        connectionStatus.innerText = 'Error';
        connectionStatus.classList.remove('connected');
        connectionStatus.classList.add('error');
        
        // Try to reconnect after a delay
        setTimeout(() => {
            if (eventSource) {
                eventSource.close();
                connectToEventStream();
            }
        }, 5000);
    };
}

function checkSubscriptionStatus() {
    fetch('/api/subscriptions')
        .then(response => response.json())
        .then(subscriptions => {
            const hasEmailSubscription = subscriptions.some(sub => 
                sub.resource.includes('/messages'));
            const hasTeamsSubscription = subscriptions.some(sub => 
                sub.resource.includes('/chats/getAllMessages'));
            
            updateSubscriptionStatus('email', hasEmailSubscription);
            updateSubscriptionStatus('teams', hasTeamsSubscription);
        })
        .catch(error => {
            console.error('Error checking subscription status:', error);
            showNotification('Error checking subscription status', 'error');
        });
}

function updateSubscriptionStatus(type, isActive) {
    const statusElement = type === 'email' ? emailSubscriptionStatus : teamsSubscriptionStatus;
    
    if (isActive) {
        statusElement.innerText = 'Active';
        statusElement.classList.add('active');
        statusElement.classList.remove('inactive');
    } else {
        statusElement.innerText = 'Not active';
        statusElement.classList.remove('active');
        statusElement.classList.add('inactive');
    }
}

function showNotification(message, type = 'info') {
    handleNotification({
        type: type,
        message: message,
        timestamp: new Date().toISOString()
    });
} 