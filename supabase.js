// =======================================
//      SUPABASE CLIENT & DATA LAYER
// =======================================

// --- Supabase Configuration & Initialization ---
const SUPABASE_URL = 'https://cyporxvxzrzgshiajtvi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5cG9yeHZ4enJ6Z3NoaWFqdHZpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NTM3NTQ0NiwiZXhwIjoyMDYwOTUxNDQ2fQ.RG3c0RrZgONEKw0mjCuseyWYs6mXA1DuswooDOrnewE';
export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Auth Functions ---
export async function handleLogin(email, password) {
    return supabase.auth.signInWithPassword({ email, password });
}

export async function handleSignup(email, password, nickname) {
    return supabase.auth.signUp({
        email, password, options: { data: { nickname } }
    });
}

export async function logout() {
    return supabase.auth.signOut();
}

export async function getSession() {
    return supabase.auth.getSession();
}

export function onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange(callback);
}

// --- User & Profile Functions ---
export async function getUserProfile(userId) {
    return supabase.from('profiles').select('*').eq('id', userId).single();
}

export async function getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('No user found');
    const { data: profile, error } = await getUserProfile(user.id);
    if (error) throw error;
    return profile;
}

export async function checkNicknameAvailability(nickname) {
    return supabase.from('profiles').select('nickname').eq('nickname', nickname).single();
}

export async function searchUsers(query, currentUserId) {
    return supabase
        .from('profiles')
        .select('*')
        .ilike('nickname', `%${query}%`)
        .neq('id', currentUserId)
        .limit(10);
}


// --- Friendship Functions ---
export async function loadFriends(currentUserId) {
    return supabase
        .from('friendships')
        .select(`id, user_id, friend_id, user_profile:profiles!user_id(id, nickname), friend_profile:profiles!friend_id(id, nickname)`)
        .or(`user_id.eq.${currentUserId},friend_id.eq.${currentUserId}`)
        .eq('status', 'accepted');
}

export async function loadFriendRequests(currentUserId) {
    return supabase
        .from('friendships')
        .select(`id, status, user_profile:profiles!user_id(id, nickname)`)
        .eq('friend_id', currentUserId)
        .eq('status', 'pending');
}

export async function getFriendshipStatus(userId1, userId2) {
    return supabase
        .from('friendships')
        .select('status')
        .or(`and(user_id.eq.${userId1},friend_id.eq.${userId2}),and(user_id.eq.${userId2},friend_id.eq.${userId1})`)
        .maybeSingle();
}

export async function sendFriendRequest(senderId, receiverId) {
    return supabase.from('friendships').insert({ user_id: senderId, friend_id: receiverId, status: 'pending' });
}

export async function acceptFriendRequest(requestId) {
    return supabase.from('friendships').update({ status: 'accepted' }).eq('id', requestId);
}

export async function declineFriendRequest(requestId) {
    return supabase.from('friendships').delete().eq('id', requestId);
}

export async function removeFriend(userId1, userId2) {
    return supabase.from('friendships').delete().or(`and(user_id.eq.${userId1},friend_id.eq.${userId2}),and(user_id.eq.${userId2},friend_id.eq.${userId1})`);
}

export async function blockUser(blockerId, blockedId) {
    await supabase.from('friendships').delete().or(`and(user_id.eq.${blockerId},friend_id.eq.${blockedId}),and(user_id.eq.${blockedId},friend_id.eq.${blockerId})`);
    return supabase.from('friendships').insert({ user_id: blockerId, friend_id: blockedId, status: 'blocked' });
}


// --- Message Functions ---
export async function loadMessages(userId1, userId2) {
    return supabase
        .from('messages')
        .select('*, sender:profiles!sender_id(nickname)')
        .or(`and(sender_id.eq.${userId1},receiver_id.eq.${userId2}),and(sender_id.eq.${userId2},receiver_id.eq.${userId1})`)
        .order('created_at');
}

export async function sendMessage(senderId, receiverId, content) {
    return supabase.from('messages').insert({
        sender_id: senderId,
        receiver_id: receiverId,
        content: content
    });
}

// --- Real-time Subscription Functions ---
export function subscribeToMessages(currentUserId, callback) {
    const channelName = `messages-for-${currentUserId}`;
    return supabase
        .channel(channelName)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `receiver_id=eq.${currentUserId}`
        }, callback)
        .subscribe();
}

export function subscribeToFriendRequests(currentUserId, callback) {
    const channelName = `friendships-for-${currentUserId}`;
    return supabase
        .channel(channelName)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'friendships',
            filter: `friend_id=eq.${currentUserId}`
        }, callback)
        .subscribe();
}

export function removeSubscription(subscription) {
    if (subscription) {
        supabase.removeChannel(subscription);
    }
}