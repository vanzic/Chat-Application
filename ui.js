// =======================================
//      UI LOGIC & EVENT HANDLING
// =======================================

import {
    handleLogin as apiLogin,
    handleSignup as apiSignup,
    logout as apiLogout,
    getSession,
    onAuthStateChange,
    getCurrentUser,
    checkNicknameAvailability,
    searchUsers,
    loadFriends as apiLoadFriends,
    loadFriendRequests as apiLoadFriendRequests,
    getFriendshipStatus,
    sendFriendRequest as apiSendFriendRequest,
    acceptFriendRequest as apiAcceptFriendRequest,
    declineFriendRequest as apiDeclineFriendRequest,
    removeFriend as apiRemoveFriend,
    blockUser as apiBlockUser,
    loadMessages as apiLoadMessages,
    sendMessage as apiSendMessage,
    subscribeToMessages,
    subscribeToFriendRequests,
    removeSubscription
} from './supabase.js';

// --- Global State ---
let currentUser = null;
let currentChat = null;
let friends = [];
let friendRequests = [];
let messageSubscription = null;
let friendRequestSubscription = null;
let nicknameCheckTimeout = null;
let searchTimeout = null;

// --- DOM Elements ---
const authContainer = document.getElementById('auth-container');
const chatContainer = document.getElementById('chat-container');
const landingPage = document.getElementById('landing-page');
const loginPage = document.getElementById('login-page');
const signupPage = document.getElementById('signup-page');
const chatWindow = document.getElementById('chat-window');
const welcomeState = document.getElementById('welcome-state');

// --- App Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
    setupNetworkMonitoring();
});

async function initializeApp() {
    try {
        const { data: { session } } = await getSession();
        if (session) {
            await loadUserData();
            showChatInterface();
        } else {
            showLandingPage();
        }

        onAuthStateChange(async (event, session) => {
            if (event === 'SIGNED_IN' && session) {
                await loadUserData();
                showChatInterface();
            } else if (event === 'SIGNED_OUT') {
                cleanupAfterLogout();
                showLandingPage();
            }
        });
    } catch (error) {
        console.error('App initialization error:', error);
        showToast('Failed to initialize app.', 'error');
    }
}

function setupEventListeners() {
    // Auth navigation
    document.getElementById('landing-login-btn').addEventListener('click', showLogin);
    document.getElementById('landing-signup-btn').addEventListener('click', showSignup);
    document.getElementById('signup-link').addEventListener('click', showSignup);
    document.getElementById('login-link').addEventListener('click', showLogin);
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    // Forms
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('signup-form').addEventListener('submit', handleSignup);
    document.getElementById('message-form').addEventListener('submit', handleSendMessage);
    setupFormValidation();
    
    // Friend actions
    setupFriendSearchListeners();
    document.getElementById('friend-requests').addEventListener('click', handleFriendRequestAction);
    document.getElementById('remove-friend-btn').addEventListener('click', () => { if (currentChat) handleRemoveFriend(currentChat.id); });
    document.getElementById('block-friend-btn').addEventListener('click', () => { if (currentChat) handleBlockUser(currentChat.id); });

    // Refresh buttons
    document.getElementById('refresh-friends-btn').addEventListener('click', () => { fetchFriendsAndRequests(); });
    document.getElementById('refresh-messages-btn').addEventListener('click', fetchMessages);
    
    // UI Interaction
    document.getElementById('mobile-back-btn').addEventListener('click', showFriendsList);
    const friendOptionsBtn = document.getElementById('friend-options-btn');
    const friendOptionsMenu = document.getElementById('friend-options-menu');
    friendOptionsBtn.addEventListener('click', (e) => { e.stopPropagation(); friendOptionsMenu.classList.toggle('hidden'); });
    document.addEventListener('click', () => friendOptionsMenu.classList.add('hidden'));
    document.getElementById('message-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('message-form').requestSubmit(); }
    });
    
    // Modal
    const confirmationModal = document.getElementById('confirmation-modal');
    document.getElementById('modal-cancel').addEventListener('click', () => confirmationModal.classList.add('hidden'));
    confirmationModal.addEventListener('click', (e) => {
        if (e.target === confirmationModal || e.target.classList.contains('modal-backdrop')) { confirmationModal.classList.add('hidden'); }
    });
}

// --- Auth & User Management ---
async function handleLogin(e) {
    e.preventDefault();
    setLoadingState('login', true);
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const { error } = await apiLogin(email, password);
    if (error) handleAuthError(error);
    setLoadingState('login', false);
}

async function handleSignup(e) {
    e.preventDefault();
    setLoadingState('signup', true);
    const nickname = document.getElementById('signup-nickname').value.trim().replace('@', '');
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const { data, error } = await apiSignup(email, password, nickname);

    if (error) {
        handleAuthError(error);
    } else if (data.user && data.user.identities && data.user.identities.length === 0) {
        showToast('Email already registered. Try logging in.', 'error');
    } else {
        showToast('Account created! Please check your email for verification.', 'success');
        showLogin();
    }
    setLoadingState('signup', false);
}

async function handleLogout() {
    setLoadingState('logout', true);
    await apiLogout();
    showToast('Logged out successfully.', 'success');
    setLoadingState('logout', false);
}

async function loadUserData() {
    try {
        currentUser = await getCurrentUser();
        document.getElementById('current-user-name').textContent = '@' + currentUser.nickname;
    } catch (error) {
        console.error('Error loading user:', error);
        showToast('Failed to load user profile.', 'error');
        handleLogout();
    }
}

function cleanupAfterLogout() {
    removeSubscription(messageSubscription);
    removeSubscription(friendRequestSubscription);
    currentUser = null;
    currentChat = null;
    friends = [];
    friendRequests = [];
}

// --- Data Fetching & Rendering ---
async function showChatInterface() {
    authContainer.classList.add('hidden');
    chatContainer.classList.remove('hidden');
    await fetchFriendsAndRequests();
    setupRealtimeSubscriptions();
    updateStats();
}

async function fetchFriendsAndRequests() {
    await Promise.all([fetchFriends(), fetchFriendRequests()]);
}

async function fetchFriends() {
    const { data, error } = await apiLoadFriends(currentUser.id);
    if (error) {
        console.error('Error loading friends:', error);
        showFriendsError();
        return;
    }
    friends = data.map(f => f.user_id === currentUser.id ? f.friend_profile : f.user_profile);
    renderFriends();
}

async function fetchFriendRequests() {
    const { data, error } = await apiLoadFriendRequests(currentUser.id);
    if (error) { console.error('Error loading friend requests:', error); return; }
    friendRequests = data || [];
    renderFriendRequests();
}

function renderFriends() {
    const friendsList = document.getElementById('friends-list');
    document.getElementById('friends-count').textContent = friends.length;
    if (friends.length === 0) {
        friendsList.innerHTML = '<div class="empty-state">No friends yet.</div>';
        return;
    }
    friendsList.innerHTML = friends.map(friend => `
        <div class="friend-item" data-friend-id="${friend.id}">
            <div class="friend-avatar">${friend.nickname.charAt(0).toUpperCase()}</div>
            <div class="friend-info"><h4>${sanitizeHTML(friend.nickname)}</h4><div class="friend-nickname">@${sanitizeHTML(friend.nickname)}</div></div>
        </div>`).join('');
    friendsList.querySelectorAll('.friend-item').forEach(item => {
        item.addEventListener('click', () => selectFriend(item.dataset.friendId));
    });
}

function renderFriendRequests() {
    const requestsList = document.getElementById('friend-requests');
    document.getElementById('requests-count').textContent = friendRequests.length;
    if (friendRequests.length === 0) {
        requestsList.innerHTML = '<div class="empty-state">No pending requests.</div>';
        return;
    }
    requestsList.innerHTML = friendRequests.map(req => `
        <div class="friend-request-item" data-req-id="${req.id}">
            <div class="request-avatar">${req.user_profile.nickname.charAt(0).toUpperCase()}</div>
            <div class="request-info"><h5>${sanitizeHTML(req.user_profile.nickname)}</h5></div>
            <div class="request-actions">
                <button class="accept-btn">Accept</button>
                <button class="decline-btn">Decline</button>
            </div>
        </div>`).join('');
}

// --- Friend Actions ---
function handleFriendRequestAction(e) {
    const acceptBtn = e.target.closest('.accept-btn');
    const declineBtn = e.target.closest('.decline-btn');
    const item = e.target.closest('.friend-request-item');
    if (!item) return;

    const requestId = item.dataset.reqId;
    if (acceptBtn) handleAcceptFriendRequest(requestId, item);
    if (declineBtn) handleDeclineFriendRequest(requestId, item);
}

async function handleAcceptFriendRequest(requestId, item) {
    if (item) item.style.opacity = '0.5';
    const { error } = await apiAcceptFriendRequest(requestId);
    if (error) {
        showToast('Failed to accept request.', 'error');
        if (item) item.style.opacity = '1';
    } else {
        showToast('Friend request accepted!', 'success');
        fetchFriendsAndRequests();
    }
}

async function handleDeclineFriendRequest(requestId, item) {
    if (item) item.style.opacity = '0.5';
    const { error } = await apiDeclineFriendRequest(requestId);
    if (error) {
        showToast('Failed to decline request.', 'error');
        if (item) item.style.opacity = '1';
    } else {
        showToast('Friend request declined.', 'info');
        fetchFriendRequests();
    }
}

async function handleRemoveFriend(friendId) {
    showConfirmationModal('Remove Friend', 'Are you sure you want to remove this friend?', async () => {
        const { error } = await apiRemoveFriend(currentUser.id, friendId);
        if (error) { showToast('Failed to remove friend.', 'error'); }
        else {
            showToast('Friend removed.', 'success');
            currentChat = null;
            chatWindow.classList.add('hidden');
            welcomeState.classList.remove('hidden');
            fetchFriends();
            showFriendsList();
        }
    });
}

async function handleBlockUser(userId) {
    showConfirmationModal('Block User', 'This will remove them as a friend and prevent future requests. Are you sure?', async () => {
        const { error } = await apiBlockUser(currentUser.id, userId);
        if (error) { showToast('Failed to block user.', 'error'); }
        else {
            showToast('User blocked.', 'success');
            currentChat = null;
            chatWindow.classList.add('hidden');
            welcomeState.classList.remove('hidden');
            fetchFriends();
            showFriendsList();
        }
    });
}

// --- Messaging ---
function selectFriend(friendId) {
    const friend = friends.find(f => f.id === friendId);
    if (!friend) return;
    currentChat = friend;

    document.querySelectorAll('.friend-item').forEach(el => el.classList.remove('active'));
    document.querySelector(`.friend-item[data-friend-id="${friendId}"]`).classList.add('active');

    welcomeState.classList.add('hidden');
    chatWindow.classList.remove('hidden');
    chatWindow.querySelector('.recipient-avatar').textContent = friend.nickname.charAt(0).toUpperCase();
    document.getElementById('recipient-name').textContent = friend.nickname;
    document.getElementById('recipient-nickname').textContent = '@' + friend.nickname;

    if (window.innerWidth <= 768) {
        document.querySelector('.chat-main').classList.add('mobile-chat-active');
    }

    fetchMessages();
    setupMessageSubscription();
}

async function fetchMessages() {
    if (!currentChat) return;
    const messagesArea = document.getElementById('messages-area');
    messagesArea.innerHTML = `<div class="messages-loading"><div class="loading-spinner-sm"></div></div>`;

    const { data, error } = await apiLoadMessages(currentUser.id, currentChat.id);
    if (error) { messagesArea.innerHTML = `<div class="empty-state">Error loading messages.</div>`; }
    else { renderMessages(data); }
}

function renderMessages(messages) {
    const messagesArea = document.getElementById('messages-area');
    if (messages.length === 0) {
        messagesArea.innerHTML = `<div class="empty-state">Start the conversation!</div>`;
        return;
    }
    messagesArea.innerHTML = messages.map(msg => {
        const isSent = msg.sender_id === currentUser.id;
        const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `
            <div class="message ${isSent ? 'sent' : 'received'}">
                <div class="message-bubble">
                    <div class="message-content">${sanitizeHTML(msg.content)}</div>
                    <div class="message-time">${time}</div>
                </div>
            </div>`;
    }).join('');
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

async function handleSendMessage(e) {
    e.preventDefault();
    if (!currentChat) return;
    const messageInput = document.getElementById('message-input');
    const content = messageInput.value.trim();
    if (!content) return;

    appendMessage({
        sender_id: currentUser.id,
        content: content,
        created_at: new Date().toISOString(),
    });

    messageInput.value = '';
    messageInput.dispatchEvent(new Event('input'));
    setMessageSending(true);

    const { error } = await apiSendMessage(currentUser.id, currentChat.id, content);
    if (error) { showToast('Failed to send message.', 'error'); }
    setMessageSending(false);
}

// --- Real-time Subscriptions ---
function setupRealtimeSubscriptions() {
    setupMessageSubscription();
    setupFriendRequestSubscription();
}

function setupMessageSubscription() {
    removeSubscription(messageSubscription);
    if (!currentUser) return;
    messageSubscription = subscribeToMessages(currentUser.id, (payload) => {
        if (currentChat && payload.new.sender_id === currentChat.id) {
            appendMessage(payload.new);
        } else {
            showToast(`You have a new message!`, 'info');
        }
    });
}

function setupFriendRequestSubscription() {
    removeSubscription(friendRequestSubscription);
    if (!currentUser) return;
    friendRequestSubscription = subscribeToFriendRequests(currentUser.id, () => {
        fetchFriendsAndRequests();
    });
}

function appendMessage(message) {
    const messagesArea = document.getElementById('messages-area');
    if (messagesArea.querySelector('.empty-state, .messages-loading')) {
        messagesArea.innerHTML = '';
    }
    const isSent = message.sender_id === currentUser.id;
    const time = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const messageEl = document.createElement('div');
    messageEl.className = `message ${isSent ? 'sent' : 'received'}`;
    messageEl.innerHTML = `
        <div class="message-bubble">
            <div class="message-content">${sanitizeHTML(message.content)}</div>
            <div class="message-time">${time}</div>
        </div>`;
    messagesArea.appendChild(messageEl);
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

// --- Friend Search ---
function setupFriendSearchListeners() {
    const friendSearch = document.getElementById('friend-search');
    friendSearch.addEventListener('input', handleFriendSearchInput);
    friendSearch.addEventListener('focus', () => {
        if (friendSearch.value.trim().length >= 2) { handleFriendSearchInput({ target: friendSearch }); }
    });
    friendSearch.addEventListener('blur', () => setTimeout(hideSearchResults, 200));
    friendSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            friendSearch.value = '';
            hideSearchResults();
            friendSearch.blur();
        }
    });
}

function handleFriendSearchInput(e) {
    const query = e.target.value.trim();
    if (searchTimeout) clearTimeout(searchTimeout);
    if (query.length < 2) { hideSearchResults(); return; }
    const searchQuery = query.startsWith('@') ? query.substring(1) : query;
    showSearchLoading();
    searchTimeout = setTimeout(() => performUserSearch(searchQuery), 300);
}

async function performUserSearch(searchQuery) {
    try {
        const { data, error } = await searchUsers(searchQuery, currentUser.id);
        if (error) throw error;
        showSearchResults(data || []);
    } catch (error) {
        console.error('Search error:', error);
        showSearchError();
    }
}

async function handleSendFriendRequest(button, userId) {
    button.disabled = true;
    button.textContent = 'Sending...';
    
    const { data: existing } = await getFriendshipStatus(currentUser.id, userId);
    if (existing) {
        showToast('You already have a connection with this user.', 'info');
        button.closest('.search-result-action').innerHTML = `<span class="status status--info">⏳ Pending</span>`;
        return;
    }
    
    const { error } = await apiSendFriendRequest(currentUser.id, userId);
    if (error) {
        showToast('Failed to send request.', 'error');
        button.disabled = false;
        button.textContent = '+ Add Friend';
    } else {
        showToast('Friend request sent!', 'success');
        button.closest('.search-result-action').innerHTML = `<span class="status status--info">⏳ Pending</span>`;
    }
}

// --- UI Helpers & Utilities ---
function showLandingPage() { authContainer.classList.remove('hidden'); chatContainer.classList.add('hidden'); landingPage.classList.remove('hidden'); loginPage.classList.add('hidden'); signupPage.classList.add('hidden'); }
function showLogin(e) { if (e) e.preventDefault(); landingPage.classList.add('hidden'); loginPage.classList.remove('hidden'); signupPage.classList.add('hidden'); }
function showSignup(e) { if (e) e.preventDefault(); landingPage.classList.add('hidden'); loginPage.classList.add('hidden'); signupPage.classList.remove('hidden'); }
function sanitizeHTML(str) { const temp = document.createElement('div'); temp.textContent = str; return temp.innerHTML; }
function showToast(message, type = 'info', duration = 4000) { const container = document.getElementById('toast-container'); if (!container) return; const toast = document.createElement('div'); toast.className = `toast toast--${type}`; toast.innerHTML = `<div class="toast-content"><span class="toast-message">${message}</span><button class="toast-close" onclick="this.parentElement.parentElement.remove()">×</button></div>`; container.appendChild(toast); setTimeout(() => { toast.remove(); }, duration); }
function setLoadingState(context, isLoading) { const btn = document.querySelector(`#${context}-form button[type="submit"], #${context}-btn`); if (!btn) return; const text = btn.querySelector('.btn-text'); const spinner = btn.querySelector('.btn-spinner'); btn.disabled = isLoading; if (text) text.style.opacity = isLoading ? 0 : 1; if (spinner) spinner.classList.toggle('hidden', !isLoading); }
function setMessageSending(isSending) { const sendBtn = document.querySelector('.message-send-btn'); const input = document.getElementById('message-input'); if (!sendBtn || !input) return; sendBtn.disabled = isSending; input.disabled = isSending; }
function showConfirmationModal(title, message, onConfirm) { const modal = document.getElementById('confirmation-modal'); modal.querySelector('#modal-title').textContent = title; modal.querySelector('#modal-message').textContent = message; const confirmBtn = modal.querySelector('#modal-confirm'); const newConfirmBtn = confirmBtn.cloneNode(true); confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn); newConfirmBtn.addEventListener('click', () => { modal.classList.add('hidden'); onConfirm(); }); modal.classList.remove('hidden'); }
function updateStats() { document.getElementById('total-friends').textContent = friends.length; document.getElementById('pending-requests').textContent = friendRequests.length; }
function showFriendsList() { if (window.innerWidth <= 768) { document.querySelector('.chat-main').classList.remove('mobile-chat-active'); } }
function showFriendsError() { document.getElementById('friends-list').innerHTML = `<div class="error-state"><p>Failed to load friends</p><button class="btn btn--sm btn--outline" onclick="fetchFriends()">Retry</button></div>`; }
function hideNetworkError() { document.getElementById('network-status').classList.add('hidden'); }
function showNetworkError() { document.getElementById('network-status').classList.remove('hidden'); }
function handleAuthError(error) { if (error.message.includes("Invalid login credentials")) { showToast("Invalid email or password.", "error"); } else if (error.message.includes("already registered")) { showToast("This email is already registered.", "error"); } else { showToast(error.message, "error"); } }
function setupFormValidation() { document.getElementById('signup-nickname').addEventListener('input', (e) => { if (nicknameCheckTimeout) clearTimeout(nicknameCheckTimeout); const nickname = e.target.value.trim().replace('@', ''); if (nickname.length < 3) return; nicknameCheckTimeout = setTimeout(() => handleCheckNickname(nickname), 500); }); }
async function handleCheckNickname(nickname) { const statusEl = document.getElementById('nickname-availability'); statusEl.className = 'nickname-status checking'; statusEl.innerHTML = '⏳ Checking...'; statusEl.classList.remove('hidden'); const { data, error } = await checkNicknameAvailability(nickname); if (error && error.code !== 'PGRST116') { statusEl.classList.add('hidden'); return; } statusEl.className = data ? 'nickname-status unavailable' : 'nickname-status available'; statusEl.innerHTML = data ? '❌ Username not available' : '✅ Username available'; }
function setupNetworkMonitoring() { window.addEventListener('online', () => showToast('Connection restored', 'success')); window.addEventListener('offline', () => showNetworkError()); }
function showSearchLoading() { const searchResults = document.getElementById('search-results'); searchResults.innerHTML = `<div class="search-loading"><div class="loading-spinner-sm"></div><span>Searching...</span></div>`; searchResults.classList.remove('hidden'); }
function showSearchError() { const searchResults = document.getElementById('search-results'); searchResults.innerHTML = `<div class="search-empty"><span>❌ Search failed. Please try again.</span></div>`; searchResults.classList.remove('hidden'); }
function showSearchResults(users) { const searchResults = document.getElementById('search-results'); if (users.length === 0) { searchResults.innerHTML = '<div class="search-empty">🔍 No users found</div>'; searchResults.classList.remove('hidden'); return; } searchResults.innerHTML = users.map(user => { const isFriend = friends.some(f => f.id === user.id); const hasPendingRequest = friendRequests.some(r => (r.user_profile.id === user.id && r.status === 'pending')); let buttonHTML = ''; if (isFriend) { buttonHTML = '<span class="status status--success">✓ Friend</span>'; } else if (hasPendingRequest) { buttonHTML = '<span class="status status--info">⏳ Pending</span>'; } else { buttonHTML = `<button class="btn btn--primary btn--sm add-friend-btn" data-user-id="${user.id}">+ Add Friend</button>`; } return `<div class="search-result-item" data-user-id="${user.id}"><div class="search-result-user"><div class="search-result-avatar">${user.nickname.charAt(0).toUpperCase()}</div><div class="search-result-info"><h5>${sanitizeHTML(user.nickname)}</h5><div class="nickname">@${sanitizeHTML(user.nickname)}</div></div></div><div class="search-result-action">${buttonHTML}</div></div>`; }).join(''); searchResults.classList.remove('hidden'); searchResults.querySelectorAll('.add-friend-btn').forEach(btn => btn.addEventListener('click', (e) => handleSendFriendRequest(e.target, e.target.dataset.userId))); }
function hideSearchResults() { const searchResults = document.getElementById('search-results'); if (searchResults) { searchResults.classList.add('hidden'); searchResults.innerHTML = ''; } }