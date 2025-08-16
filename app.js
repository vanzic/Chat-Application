// Supabase Configuration
const SUPABASE_URL = 'https://cyporxvxzrzgshiajtvi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5cG9yeHZ4enJ6Z3NoaWFqdHZpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NTM3NTQ0NiwiZXhwIjoyMDYwOTUxNDQ2fQ.RG3c0RrZgONEKw0mjCuseyWYs6mXA1DuswooDOrnewE';

// Initialize Supabase client
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Global state
let currentUser = null;
let currentChat = null;
let friends = [];
let friendRequests = [];
let messageSubscription = null;
let friendRequestSubscription = null;
let isOnline = navigator.onLine;
let nicknameCheckTimeout = null;
let searchTimeout = null;

// DOM Elements
const authContainer = document.getElementById('auth-container');
const chatContainer = document.getElementById('chat-container');
const landingPage = document.getElementById('landing-page');
const loginPage = document.getElementById('login-page');
const signupPage = document.getElementById('signup-page');

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
    setupNetworkMonitoring();
    setupFormValidation();
});

function setupEventListeners() {
    // Landing page buttons
    document.getElementById('landing-login-btn').addEventListener('click', showLogin);
    document.getElementById('landing-signup-btn').addEventListener('click', showSignup);

    // Auth form navigation
    document.getElementById('signup-link').addEventListener('click', showSignup);
    document.getElementById('login-link').addEventListener('click', showLogin);

    // Logout button
    document.getElementById('logout-btn').addEventListener('click', logout);

    // Auth forms
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('signup-form').addEventListener('submit', handleSignup);

    // Message form
    document.getElementById('message-form').addEventListener('submit', handleSendMessage);

    // Friend search listeners
    setupFriendSearchListeners();

    // Friend Requests List (Event Delegation)
    document.getElementById('friend-requests').addEventListener('click', handleFriendRequestAction);

    // Refresh buttons
    document.getElementById('refresh-friends-btn').addEventListener('click', () => {
        loadFriends();
        loadFriendRequests();
    });
    document.getElementById('refresh-messages-btn').addEventListener('click', loadMessages);

    // Mobile back button
    document.getElementById('mobile-back-btn').addEventListener('click', showFriendsList);

    // Friend options menu
    const friendOptionsBtn = document.getElementById('friend-options-btn');
    const friendOptionsMenu = document.getElementById('friend-options-menu');
    friendOptionsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        friendOptionsMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', () => friendOptionsMenu.classList.add('hidden'));

    // Friend action buttons
    document.getElementById('remove-friend-btn').addEventListener('click', () => {
        if (currentChat) removeFriend(currentChat.id);
    });
    document.getElementById('block-friend-btn').addEventListener('click', () => {
        if (currentChat) blockUser(currentChat.id);
    });

    // Modal close handlers
    const confirmationModal = document.getElementById('confirmation-modal');
    document.getElementById('modal-cancel').addEventListener('click', () => confirmationModal.classList.add('hidden'));
    confirmationModal.addEventListener('click', (e) => {
        if (e.target === confirmationModal || e.target.classList.contains('modal-backdrop')) {
            confirmationModal.classList.add('hidden');
        }
    });

    // Message input enter key handler
    document.getElementById('message-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            document.getElementById('message-form').requestSubmit();
        }
    });
}

// Network monitoring
function setupNetworkMonitoring() {
    window.addEventListener('online', () => {
        isOnline = true;
        hideNetworkError();
        showToast('Connection restored', 'success');
    });
    window.addEventListener('offline', () => {
        isOnline = false;
        showNetworkError();
    });
}

// Form validation
function setupFormValidation() {
    const signupNickname = document.getElementById('signup-nickname');
    signupNickname.addEventListener('input', handleNicknameInput);
    signupNickname.addEventListener('blur', () => validateNickname(signupNickname));
    document.getElementById('signup-email').addEventListener('blur', (e) => validateEmail(e.target));
    document.getElementById('signup-password').addEventListener('input', (e) => validatePassword(e.target));
    document.getElementById('login-email').addEventListener('blur', (e) => validateEmail(e.target));
}

async function initializeApp() {
    try {
        const { data: { session } } = await supabase.auth.getSession();

        if (session) {
            await loadUser();
            showChatInterface();
        } else {
            showLandingPage();
        }

        supabase.auth.onAuthStateChange(async (event, session) => {
            if (event === 'SIGNED_IN' && session) {
                await loadUser();
                showChatInterface();
            } else if (event === 'SIGNED_OUT') {
                if (messageSubscription) messageSubscription.unsubscribe();
                if (friendRequestSubscription) friendRequestSubscription.unsubscribe();
                currentUser = null;
                currentChat = null;
                showLandingPage();
            }
        });
    } catch (error) {
        console.error('App initialization error:', error);
        showToast('Failed to initialize app.', 'error');
    }
}

// --- FRIEND SEARCH ---

function setupFriendSearchListeners() {
    const friendSearch = document.getElementById('friend-search');
    friendSearch.addEventListener('input', handleFriendSearch);
    friendSearch.addEventListener('focus', () => {
        if (friendSearch.value.trim().length >= 2) {
            handleFriendSearch({ target: friendSearch });
        }
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

function handleFriendSearch(e) {
    const query = e.target.value.trim();
    if (searchTimeout) clearTimeout(searchTimeout);

    if (query.length < 2) {
        hideSearchResults();
        return;
    }

    const searchQuery = query.startsWith('@') ? query.substring(1) : query;
    showSearchLoading();

    searchTimeout = setTimeout(async () => {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .ilike('nickname', `%${searchQuery}%`)
                .neq('id', currentUser.id)
                .limit(10);

            if (error) throw error;
            showSearchResults(data || []);
        } catch (error) {
            console.error('Search error:', error);
            showSearchError();
        }
    }, 300);
}

function showSearchLoading() {
    const searchResults = document.getElementById('search-results');
    searchResults.innerHTML = `<div class="search-loading"><div class="loading-spinner-sm"></div><span>Searching...</span></div>`;
    searchResults.classList.remove('hidden');
}

function showSearchError() {
    const searchResults = document.getElementById('search-results');
    searchResults.innerHTML = `<div class="search-empty"><span>❌ Search failed. Please try again.</span></div>`;
    searchResults.classList.remove('hidden');
}

function showSearchResults(users) {
    const searchResults = document.getElementById('search-results');
    if (users.length === 0) {
        searchResults.innerHTML = '<div class="search-empty">🔍 No users found</div>';
        searchResults.classList.remove('hidden');
        return;
    }

    const resultsHTML = users.map(user => {
        const isFriend = friends.some(f => f.id === user.id);
        const hasPendingRequest = friendRequests.some(r => (r.user_profile.id === user.id && r.status === 'pending'));

        let buttonHTML = '';
        if (isFriend) {
            buttonHTML = '<span class="status status--success">✓ Friend</span>';
        } else if (hasPendingRequest) {
            buttonHTML = '<span class="status status--info">⏳ Pending</span>';
        } else {
            buttonHTML = `<button class="btn btn--primary btn--sm add-friend-btn" data-user-id="${user.id}">+ Add Friend</button>`;
        }

        return `
            <div class="search-result-item" data-user-id="${user.id}">
                <div class="search-result-user">
                    <div class="search-result-avatar">${user.nickname.charAt(0).toUpperCase()}</div>
                    <div class="search-result-info">
                        <h5>${sanitizeHTML(user.nickname)}</h5>
                        <div class="nickname">@${sanitizeHTML(user.nickname)}</div>
                    </div>
                </div>
                <div class="search-result-action">${buttonHTML}</div>
            </div>`;
    }).join('');

    searchResults.innerHTML = resultsHTML;
    searchResults.classList.remove('hidden');
    attachSearchResultEventListeners();
}

function attachSearchResultEventListeners() {
    const searchResults = document.getElementById('search-results');
    searchResults.addEventListener('click', async (e) => {
        const button = e.target.closest('.add-friend-btn');
        if (button) {
            e.preventDefault();
            const userId = button.dataset.userId;
            if (userId) {
                button.disabled = true;
                button.textContent = 'Sending...';
                await sendFriendRequest(userId);
                const actionContainer = button.closest('.search-result-action');
                if (actionContainer) {
                    actionContainer.innerHTML = '<span class="status status--info">⏳ Pending</span>';
                }
            }
        }
    });
}

function hideSearchResults() {
    const searchResults = document.getElementById('search-results');
    if (searchResults) {
        searchResults.classList.add('hidden');
        searchResults.innerHTML = '';
    }
}

// --- AUTH & USER MGMT ---

async function handleLogin(e) {
    e.preventDefault();
    setLoadingState('login', true);
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) handleAuthError(error, 'login');

    setLoadingState('login', false);
}

async function handleSignup(e) {
    e.preventDefault();
    setLoadingState('signup', true);
    const nickname = document.getElementById('signup-nickname').value.trim().replace('@', '');
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;

    const { data, error } = await supabase.auth.signUp({
        email, password, options: { data: { nickname } }
    });

    if (error) {
        handleAuthError(error, 'signup');
    } else if (data.user && data.user.identities && data.user.identities.length === 0) {
        showToast('Email already registered. Try logging in.', 'error');
    } else {
        showToast('Account created! Please check your email for verification.', 'success');
        showLogin();
    }
    setLoadingState('signup', false);
}

async function logout() {
    setLoadingState('logout', true);
    await supabase.auth.signOut();
    showToast('Logged out successfully.', 'success');
    setLoadingState('logout', false);
}

async function loadUser() {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('No user found');

        const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
        if (error) throw error;

        currentUser = profile;
        document.getElementById('current-user-name').textContent = '@' + profile.nickname;
    } catch (error) {
        console.error('Error loading user:', error);
        showToast('Failed to load user profile.', 'error');
        logout();
    }
}

// --- DATA LOADING & RENDERING ---

async function showChatInterface() {
    authContainer.classList.add('hidden');
    chatContainer.classList.remove('hidden');
    await Promise.all([loadFriends(), loadFriendRequests()]);
    setupFriendRequestSubscription();
    updateStats();
}

async function loadFriends() {
    const { data, error } = await supabase
        .from('friendships')
        .select(`id, user_id, friend_id, user_profile:profiles!user_id(id, nickname), friend_profile:profiles!friend_id(id, nickname)`)
        .or(`user_id.eq.${currentUser.id},friend_id.eq.${currentUser.id}`)
        .eq('status', 'accepted');

    if (error) {
        console.error('Error loading friends:', error);
        showFriendsError();
        return;
    }
    friends = data.map(f => f.user_id === currentUser.id ? f.friend_profile : f.user_profile);
    renderFriends();
}

async function loadFriendRequests() {
    const { data, error } = await supabase
        .from('friendships')
        .select(`id, status, user_profile:profiles!user_id(id, nickname)`)
        .eq('friend_id', currentUser.id)
        .eq('status', 'pending');

    if (error) {
        console.error('Error loading friend requests:', error);
        return;
    }
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

// --- FRIEND ACTIONS ---

function handleFriendRequestAction(e) {
    const acceptButton = e.target.closest('.accept-btn');
    const declineButton = e.target.closest('.decline-btn');
    const item = e.target.closest('.friend-request-item');

    if (!item) return;
    const requestId = item.dataset.reqId;

    if (acceptButton) {
        acceptFriendRequest(requestId);
    } else if (declineButton) {
        declineFriendRequest(requestId);
    }
}

async function sendFriendRequest(friendId) {
    try {
        const { data: existing } = await supabase
            .from('friendships')
            .select('status')
            .or(`and(user_id.eq.${currentUser.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${currentUser.id})`)
            .maybeSingle();

        if (existing) {
            showToast('You already have a connection with this user.', 'info');
            return;
        }

        const { error } = await supabase.from('friendships').insert({ user_id: currentUser.id, friend_id: friendId, status: 'pending' });
        if (error) throw error;
        showToast('Friend request sent!', 'success');
    } catch (error) {
        console.error('Error sending friend request:', error);
        showToast('Failed to send request.', 'error');
    }
}

async function acceptFriendRequest(requestId) {
    const item = document.querySelector(`.friend-request-item[data-req-id="${requestId}"]`);
    if (item) item.style.opacity = '0.5';

    const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', requestId);
    if (error) {
        showToast('Failed to accept request.', 'error');
        if (item) item.style.opacity = '1';
    } else {
        showToast('Friend request accepted!', 'success');
        await loadFriends();
        await loadFriendRequests();
    }
}

async function declineFriendRequest(requestId) {
    const item = document.querySelector(`.friend-request-item[data-req-id="${requestId}"]`);
    if (item) item.style.opacity = '0.5';

    const { error } = await supabase.from('friendships').delete().eq('id', requestId);
    if (error) {
        showToast('Failed to decline request.', 'error');
        if (item) item.style.opacity = '1';
    } else {
        showToast('Friend request declined.', 'info');
        await loadFriendRequests();
    }
}

async function removeFriend(friendId) {
    showConfirmationModal('Remove Friend', 'Are you sure you want to remove this friend?', async () => {
        const { error } = await supabase.from('friendships').delete().or(`and(user_id.eq.${currentUser.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${currentUser.id})`);
        if (error) {
            showToast('Failed to remove friend.', 'error');
        } else {
            showToast('Friend removed.', 'success');
            currentChat = null;
            document.getElementById('chat-window').classList.add('hidden');
            document.getElementById('welcome-state').classList.remove('hidden');
            loadFriends();
        }
    });
}

async function blockUser(userId) {
    showConfirmationModal('Block User', 'This will remove them as a friend and prevent future requests. Are you sure?', async () => {
        await supabase.from('friendships').delete().or(`and(user_id.eq.${currentUser.id},friend_id.eq.${userId}),and(user_id.eq.${userId},friend_id.eq.${currentUser.id})`);
        const { error } = await supabase.from('friendships').insert({ user_id: currentUser.id, friend_id: userId, status: 'blocked' });
        if (error) {
            showToast('Failed to block user.', 'error');
        } else {
            showToast('User blocked.', 'success');
            currentChat = null;
            document.getElementById('chat-window').classList.add('hidden');
            document.getElementById('welcome-state').classList.remove('hidden');
            loadFriends();
        }
    });
}

// --- MESSAGING ---

function selectFriend(friendId) {
    const friend = friends.find(f => f.id === friendId);
    if (!friend) return;
    currentChat = friend;

    document.querySelectorAll('.friend-item').forEach(el => el.classList.remove('active'));
    document.querySelector(`.friend-item[data-friend-id="${friendId}"]`).classList.add('active');

    document.getElementById('welcome-state').classList.add('hidden');
    const chatWindow = document.getElementById('chat-window');
    chatWindow.classList.remove('hidden');

    chatWindow.querySelector('.recipient-avatar').textContent = friend.nickname.charAt(0).toUpperCase();
    document.getElementById('recipient-name').textContent = friend.nickname;
    document.getElementById('recipient-nickname').textContent = '@' + friend.nickname;

    loadMessages();
    subscribeToMessages();
}

async function loadMessages() {
    if (!currentChat) return;
    const messagesArea = document.getElementById('messages-area');
    messagesArea.innerHTML = `<div class="messages-loading"><div class="loading-spinner-sm"></div></div>`;

    const { data, error } = await supabase
        .from('messages')
        .select('*, sender:profiles!sender_id(nickname)')
        .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${currentChat.id}),and(sender_id.eq.${currentChat.id},receiver_id.eq.${currentUser.id})`)
        .order('created_at');

    if (error) {
        messagesArea.innerHTML = `<div class="empty-state">Error loading messages.</div>`;
    } else {
        renderMessages(data);
    }
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

// =================================================================================
// REAL-TIME FIX 1: Optimistic UI update for the sender.
// =================================================================================
async function handleSendMessage(e) {
    e.preventDefault();
    if (!currentChat) return;
    const messageInput = document.getElementById('message-input');
    const content = messageInput.value.trim();
    if (!content) return;

    // Create a temporary message object to display immediately.
    const optimisticMessage = {
        sender_id: currentUser.id,
        content: content,
        created_at: new Date().toISOString(),
    };
    appendMessage(optimisticMessage); // Add to UI right away.

    messageInput.value = ''; // Clear the input
    messageInput.dispatchEvent(new Event('input')); // Reset character counter

    setMessageSending(true);
    const { error } = await supabase.from('messages').insert({
        sender_id: currentUser.id,
        receiver_id: currentChat.id,
        content: content
    });

    if (error) {
        showToast('Failed to send message.', 'error');
        // Optional: Add logic here to show the message failed to send.
    }
    setMessageSending(false);
}
// =================================================================================


// --- REALTIME SUBSCRIPTIONS ---

// =================================================================================
// REAL-TIME FIX 2: More efficient subscription for receiving messages.
// =================================================================================
function subscribeToMessages() {
    if (messageSubscription) messageSubscription.unsubscribe();
    if (!currentUser) return;

    // This channel listens for any new message sent specifically TO the current user.
    messageSubscription = supabase
        .channel(`messages-for-${currentUser.id}`)
        .on('postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `receiver_id=eq.${currentUser.id}`
            },
            (payload) => {
                // When a message arrives, check if it's from the person we are currently chatting with.
                if (currentChat && payload.new.sender_id === currentChat.id) {
                    appendMessage(payload.new);
                } else {
                    // Optional: If the message is from someone else, show a notification.
                    showToast(`You have a new message!`, 'info');
                    // You could also increment a notification badge here.
                }
            }
        ).subscribe();
}
// =================================================================================


function setupFriendRequestSubscription() {
    if (friendRequestSubscription) friendRequestSubscription.unsubscribe();
    friendRequestSubscription = supabase
        .channel('friendships')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships', filter: `friend_id.eq.${currentUser.id}` },
            () => {
                loadFriendRequests();
                loadFriends();
            }
        ).subscribe();
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

// --- UI HELPERS & UTILITIES ---

function showLandingPage() { authContainer.classList.remove('hidden'); chatContainer.classList.add('hidden'); landingPage.classList.remove('hidden'); loginPage.classList.add('hidden'); signupPage.classList.add('hidden'); }
function showLogin(e) { if (e) e.preventDefault(); landingPage.classList.add('hidden'); loginPage.classList.remove('hidden'); signupPage.classList.add('hidden'); }
function showSignup(e) { if (e) e.preventDefault(); landingPage.classList.add('hidden'); loginPage.classList.add('hidden'); signupPage.classList.remove('hidden'); }
function sanitizeHTML(str) { const temp = document.createElement('div'); temp.textContent = str; return temp.innerHTML; }
function showToast(message, type = 'info', duration = 4000) { const container = document.getElementById('toast-container'); if (!container) return; const toast = document.createElement('div'); toast.className = `toast toast--${type}`; toast.innerHTML = `<div class="toast-content"><span class="toast-message">${message}</span><button class="toast-close" onclick="this.parentElement.parentElement.remove()">×</button></div>`; container.appendChild(toast); setTimeout(() => { toast.remove(); }, duration); }
function setLoadingState(context, isLoading) { const btn = document.querySelector(`#${context}-form button[type="submit"], #${context}-btn`); if (!btn) return; const text = btn.querySelector('.btn-text'); const spinner = btn.querySelector('.btn-spinner'); btn.disabled = isLoading; if (text) text.style.opacity = isLoading ? 0 : 1; if (spinner) spinner.classList.toggle('hidden', !isLoading); }
function setMessageSending(isSending) { const sendBtn = document.querySelector('.message-send-btn'); const input = document.getElementById('message-input'); if (!sendBtn || !input) return; sendBtn.disabled = isSending; input.disabled = isSending; }
function showConfirmationModal(title, message, onConfirm) { const modal = document.getElementById('confirmation-modal'); modal.querySelector('#modal-title').textContent = title; modal.querySelector('#modal-message').textContent = message; const confirmBtn = modal.querySelector('#modal-confirm'); const newConfirmBtn = confirmBtn.cloneNode(true); confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn); newConfirmBtn.addEventListener('click', () => { modal.classList.add('hidden'); onConfirm(); }); modal.classList.remove('hidden'); }
function updateStats() { document.getElementById('total-friends').textContent = friends.length; document.getElementById('pending-requests').textContent = friendRequests.length; }
function showFriendsList() { if (window.innerWidth <= 768) { document.getElementById('chat-window').classList.add('hidden'); document.getElementById('welcome-state').classList.remove('hidden'); } }
function showFriendsError() { document.getElementById('friends-list').innerHTML = `<div class="error-state"><p>Failed to load friends</p><button class="btn btn--sm btn--outline" onclick="loadFriends()">Retry</button></div>`; }
function hideNetworkError() { document.getElementById('network-status').classList.add('hidden'); }
function showNetworkError() { document.getElementById('network-status').classList.remove('hidden'); }
function handleAuthError(error, context) { if (error.message.includes("Invalid login credentials")) { showToast("Invalid email or password.", "error"); } else if (error.message.includes("already registered")) { showToast("This email is already registered.", "error"); } else { showToast(error.message, "error"); } }
function handleNicknameInput(e) { let nickname = e.target.value.trim(); if (nicknameCheckTimeout) clearTimeout(nicknameCheckTimeout); const statusEl = document.getElementById('nickname-availability'); statusEl.classList.add('hidden'); if (nickname && !nickname.startsWith('@')) e.target.value = '@' + nickname; nickname = e.target.value.substring(1); if (nickname.length < 3) return; nicknameCheckTimeout = setTimeout(() => checkNicknameAvailability(nickname), 500); }
async function checkNicknameAvailability(nickname) { const statusEl = document.getElementById('nickname-availability'); statusEl.className = 'nickname-status checking'; statusEl.innerHTML = '⏳ Checking...'; statusEl.classList.remove('hidden'); const { data, error } = await supabase.from('profiles').select('nickname').eq('nickname', nickname).single(); if (error && error.code !== 'PGRST116') { statusEl.classList.add('hidden'); return; } statusEl.className = data ? 'nickname-status unavailable' : 'nickname-status available'; statusEl.innerHTML = data ? '❌ Username not available' : '✅ Username available'; }
function validateEmail(field) { /* Stub */ return true; }
function validatePassword(field) { /* Stub */ return true; }
function validateNickname(field) { /* Stub */ return true; }
function clearFieldError(field) { /* Stub */ }