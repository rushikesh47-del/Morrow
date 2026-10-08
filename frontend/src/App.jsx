import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUpRight,
  Bell,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  FileText,
  Image,
  Info,
  Mail,
  LogOut,
  MoreHorizontal,
  Paperclip,
  Phone,
  Plus,
  Search,
  Send,
  Smile,
  Sparkles,
  Video,
  X,
} from 'lucide-react'
import Auth from './Auth'
import { api } from './api'
import './App.css'

const imageUrl = (id, size = 96) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${size}&h=${size}&q=80`

const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'M'

function Avatar({ person, size = 'normal' }) {
  return (
    <span className={`avatar avatar--${person.color} avatar--${size}`}>
      <img src={imageUrl(person.image)} alt="" />
      {person.online && <span className="online-indicator" />}
    </span>
  )
}

function App() {
  const [user, setUser] = useState(null)
  const [authChecking, setAuthChecking] = useState(true)
  const [conversations, setConversations] = useState([])
  const [requests, setRequests] = useState({ incoming: [], outgoing: [] })
  const [activeId, setActiveId] = useState(null)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState('')
  const [showChat, setShowChat] = useState(false)
  const [showDetails, setShowDetails] = useState(() => window.innerWidth > 1100)
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [requestInboxOpen, setRequestInboxOpen] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [requestBusy, setRequestBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const messageListRef = useRef(null)
  const searchRef = useRef(null)
  const activeChat = conversations.find((chat) => chat.id === activeId) ?? conversations[0]
  const lastMessageDate = activeChat?.messages.at(-1)?.createdAt
    ? new Date(activeChat.messages.at(-1).createdAt)
    : new Date()
  const dateDividerLabel = lastMessageDate.toDateString() === new Date().toDateString()
    ? `Today, ${new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' }).format(lastMessageDate)}`
    : new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(lastMessageDate)

  useEffect(() => {
    let cancelled = false
    async function restoreSession() {
      let account = null
      try {
        const session = await api('/auth/me')
        account = session.user
        if (cancelled) return
        setUser(account)
        const { conversations: savedConversations } = await api('/conversations')
        if (cancelled) return
        setConversations(savedConversations)
        setActiveId(savedConversations[0]?.id ?? null)
        const latestRequests = await api('/requests')
        if (cancelled) return
        setRequests(latestRequests)
      } catch (error) {
        if (!cancelled && account) setNotice(error.message)
        else if (!cancelled) setUser(null)
      } finally {
        if (!cancelled) setAuthChecking(false)
      }
    }
    restoreSession()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!user) return undefined

    let cancelled = false
    async function sendPresenceHeartbeat() {
      try {
        await api('/auth/presence', { method: 'POST' })
      } catch (error) {
        if (!cancelled) setNotice(error.message)
      }
    }

    void sendPresenceHeartbeat()
    const interval = window.setInterval(sendPresenceHeartbeat, 10_000)
    window.addEventListener('focus', sendPresenceHeartbeat)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('focus', sendPresenceHeartbeat)
    }
  }, [user])

  useEffect(() => {
    if (!user) return undefined
    let cancelled = false

    async function refreshConversations() {
      try {
        const { conversations: latestConversations } = await api('/conversations')
        if (cancelled) return
        if (activeId) {
          await api(`/conversations/${encodeURIComponent(activeId)}/read`, { method: 'POST' })
          if (cancelled) return
        }
        setConversations(latestConversations.map((chat) =>
          chat.id === activeId ? { ...chat, unread: 0 } : chat))
        const latestRequests = await api('/requests')
        if (cancelled) return
        setRequests(latestRequests)
      } catch (error) {
        if (!cancelled) setNotice(error.message)
      }
    }

    const interval = window.setInterval(refreshConversations, 4000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [user, activeId])

  useEffect(() => {
    messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: 'smooth' })
  }, [activeId, activeChat?.messages.length])

  useEffect(() => {
    if (!notice) return undefined
    const timeout = window.setTimeout(() => setNotice(''), 2600)
    return () => window.clearTimeout(timeout)
  }, [notice])

  async function handleAuthenticated(account) {
    setUser(account)
    try {
      const { conversations: savedConversations } = await api('/conversations')
      setConversations(savedConversations)
      setActiveId(savedConversations[0]?.id ?? null)
      setRequests(await api('/requests'))
    } catch (error) {
      showNotice(error.message)
    }
  }

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' })
    } catch (error) {
      showNotice(error.message)
      return
    }
    setUser(null)
    setConversations([])
    setRequests({ incoming: [], outgoing: [] })
    setActiveId(null)
    setShowChat(false)
  }

  async function selectConversation(chat) {
    setActiveId(chat.id)
    setShowChat(true)
    setConversations((current) => current.map((item) => item.id === chat.id ? { ...item, unread: 0 } : item))
    try {
      await api(`/conversations/${encodeURIComponent(chat.id)}/read`, { method: 'POST' })
    } catch (error) {
      showNotice(error.message)
    }
  }

  async function sendMessage(event) {
    event.preventDefault()
    const text = message.trim()
    if (!text || !activeChat) return
    try {
      const { conversation } = await api(`/conversations/${encodeURIComponent(activeId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      })
      setConversations((current) => [conversation, ...current.filter((chat) => chat.id !== conversation.id)])
      setMessage('')
    } catch (error) {
      showNotice(error.message)
    }
  }

  async function createConversation(event) {
    event.preventDefault()
    const email = newEmail.trim()
    if (!email || requestBusy) return
    setRequestBusy(true)
    try {
      await api('/requests', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      setRequests(await api('/requests'))
      setNewEmail('')
      setNewChatOpen(false)
      showNotice('Request sent. You can start chatting after they accept.')
    } catch (error) {
      showNotice(error.message)
    } finally {
      setRequestBusy(false)
    }
  }

  async function acceptRequest(request) {
    try {
      const { conversation } = await api(`/requests/${encodeURIComponent(request.id)}/accept`, {
        method: 'POST',
      })
      setConversations((current) => [
        conversation,
        ...current.filter((chat) => chat.id !== conversation.id),
      ])
      setActiveId(conversation.id)
      setShowChat(true)
      setRequests(await api('/requests'))
      showNotice(`You and ${request.name} can now chat.`)
    } catch (error) {
      showNotice(error.message)
    }
  }

  async function declineRequest(request) {
    try {
      await api(`/requests/${encodeURIComponent(request.id)}/decline`, {
        method: 'POST',
      })
      setRequests(await api('/requests'))
    } catch (error) {
      showNotice(error.message)
    }
  }

  const visibleConversations = conversations.filter((chat) => {
    const matchesSearch = `${chat.name} ${chat.preview}`.toLowerCase().includes(search.toLowerCase())
    return matchesSearch && (filter === 'all' || chat.unread > 0)
  })

  function showNotice(text) {
    setNotice(text)
  }

  if (authChecking) {
    return <main className="auth-loading"><span className="brand-mark"><span /></span><span>morrow</span></main>
  }

  if (!user) return <Auth onAuthenticated={handleAuthenticated} />

  return (
    <main className="app-shell">
      <aside className={`sidebar ${showChat ? 'sidebar--hidden-mobile' : ''}`}>
        <div className="brand-row">
          <a className="brand" href="#home" aria-label="Morrow home"><span className="brand-mark"><span /></span>morrow<span className="brand-period">.</span></a>
          <button className="icon-button sidebar-menu" aria-label="More options" onClick={() => showNotice('You’re all caught up.')}><MoreHorizontal size={19} /></button>
        </div>

        <div className="workspace-switcher">
          <span className="workspace-symbol">s</span>
          <span className="workspace-label"><strong>Studio North</strong><small>Free workspace</small></span>
          <ChevronDown size={16} />
        </div>

        <div className="sidebar-search">
          <Search size={16} />
          <input ref={searchRef} aria-label="Search conversations" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people..." />
          <button aria-label="Focus search" onClick={() => searchRef.current?.focus()}><span>⌘</span>K</button>
        </div>

        <div className="section-heading"><span>MESSAGES</span><span className="section-actions"><button className="icon-button small-icon request-inbox-button" aria-label={`Requests inbox, ${requests.incoming.length} incoming`} title="Requests inbox" onClick={() => setRequestInboxOpen(true)}><Mail size={15} />{requests.incoming.length > 0 && <span className="request-count">{requests.incoming.length}</span>}</button><button className="icon-button small-icon" aria-label="Send a conversation request" onClick={() => setNewChatOpen(true)}><Plus size={16} /></button></span></div>
        <div className="conversation-filters" role="tablist" aria-label="Conversation filter">
          <button className={filter === 'all' ? 'filter-active' : ''} onClick={() => setFilter('all')}>All <span>{conversations.length}</span></button>
          <button className={filter === 'unread' ? 'filter-active' : ''} onClick={() => setFilter('unread')}>Unread <span>{conversations.filter((chat) => chat.unread > 0).length}</span></button>
        </div>

        <nav className="conversation-list" aria-label="Conversations">
          {visibleConversations.map((chat) => (
            <button key={chat.id} className={`conversation-item ${activeId === chat.id ? 'conversation-item--active' : ''}`} onClick={() => selectConversation(chat)}>
              <Avatar person={chat} />
              <span className="conversation-copy"><span className="conversation-top"><strong>{chat.name}</strong><time>{chat.time}</time></span><span className="conversation-bottom"><span>{chat.preview}</span>{chat.unread > 0 && <span className="unread-count">{chat.unread}</span>}</span>
              </span>
            </button>
          ))}
          {visibleConversations.length === 0 && <p className="empty-search">No conversations found.</p>}
        </nav>

        <div className="sidebar-bottom">
          <button className="upgrade-banner" onClick={() => showNotice('You’re on the free Studio North plan.')}>
            <span className="upgrade-icon"><Sparkles size={16} /></span>
            <span><strong>A little more room?</strong><small>Explore the team plan</small></span>
            <ArrowUpRight size={15} />
          </button>
          <button className="profile-row" title="Sign out" onClick={() => void logout()}>
            <span className="profile-avatar">{initials(user.name)}<span /></span><span className="profile-copy"><strong>{user.name}</strong><small>{user.email}</small></span><LogOut size={16} />
          </button>
        </div>
      </aside>

      <section className={`chat-panel ${showChat ? 'chat-panel--visible-mobile' : ''}`} aria-label="Active conversation">
        {activeChat && <>
          <header className="chat-header">
            <div className="chat-person">
              <button className="icon-button mobile-back" aria-label="Back to conversations" onClick={() => setShowChat(false)}><ArrowLeft size={19} /></button>
              <Avatar person={activeChat} size="header" />
              <div><h1>{activeChat.name}</h1><p><span className={activeChat.online ? 'status-dot' : 'status-dot status-dot--away'} />{activeChat.online ? 'Online now' : 'Offline'}</p></div>
            </div>
            <div className="header-actions">
              <button className="icon-button" aria-label="Start voice call" title="Start voice call" onClick={() => showNotice(`Starting a call with ${activeChat.name}…`)}><Phone size={18} /></button>
              <button className="icon-button" aria-label="Start video call" title="Start video call" onClick={() => showNotice(`Starting a video call with ${activeChat.name}…`)}><Video size={19} /></button>
              <span className="action-divider" />
              <button className={`icon-button ${showDetails ? 'icon-button--selected' : ''}`} aria-label="Toggle conversation details" title="Conversation details" onClick={() => setShowDetails((current) => !current)}><Info size={19} /></button>
              <button className="icon-button more-header" aria-label="More options" onClick={() => showNotice('No more actions right now.')}><MoreHorizontal size={20} /></button>
            </div>
          </header>

          <div className="messages-scroll" ref={messageListRef}>
            <div className="chat-intro">
              <span className="intro-spark">✳</span>
              <strong>You’re chatting with {activeChat.name.split(' ')[0]}.</strong>
              <span>Your messages are saved to your workspace.</span>
            </div>
            <div className="date-divider"><span />{dateDividerLabel}<span /></div>
            <div className="message-list">
              {activeChat.messages.map((item) => (
                <article key={item.id} className={`message-row ${item.from === 'me' ? 'message-row--mine' : ''}`}>
                  {item.from === 'them' ? <Avatar person={activeChat} size="message" /> : <span className="message-avatar-self">{initials(user.name)}</span>}
                  <div className="message-body">
                    <div className="message-meta"><strong>{item.from === 'me' ? 'You' : activeChat.name}</strong><time>{item.time}</time></div>
                    <div className={`message-bubble ${item.from === 'me' ? 'message-bubble--mine' : ''}`}>{item.text}</div>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="composer-wrap">
            <form className="composer" onSubmit={sendMessage}>
              <textarea aria-label="Write a message" placeholder={`Message ${activeChat.name.split(' ')[0]}...`} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(event) } }} rows={2} />
              <div className="composer-toolbar">
                <div className="composer-tools">
                  <button type="button" aria-label="Attach file" title="Attach file" onClick={() => showNotice('File attachments are coming soon.')}><Paperclip size={17} /></button>
                  <button type="button" aria-label="Add image" title="Add image" onClick={() => showNotice('Image sharing is coming soon.')}><Image size={17} /></button>
                  <button type="button" aria-label="Add emoji" title="Add emoji" onClick={() => setMessage((current) => `${current}${current ? ' ' : ''}✨`)}><Smile size={17} /></button>
                  <button type="button" aria-label="Add note" title="Add note" onClick={() => showNotice('Notes are coming soon.')}><FileText size={16} /></button>
                </div>
                <div className="send-controls"><span><kbd>↵</kbd> to send</span><button className="send-button" type="submit" disabled={!message.trim()} aria-label="Send message"><Send size={16} /></button></div>
              </div>
            </form>
            <div className="composer-footnote"><span><span className="secure-dot" />Messages are private to your workspace</span><button aria-label="Help" onClick={() => showNotice('Your messages are saved to your account and available when you sign in.')}><CircleHelp size={15} /></button></div>
          </div>
        </>}
        {!activeChat && <div className="empty-conversation"><span className="empty-conversation-mark"><span /></span><h1>Your conversations start here.</h1><p>Find someone already on Morrow and send them a message.</p><button className="empty-start-button" onClick={() => setNewChatOpen(true)}><Plus size={16} />Start a conversation</button></div>}
      </section>

      {activeChat && <aside className={`details-panel ${showDetails ? 'details-panel--open' : ''}`}>
        <div className="details-top"><span>DETAILS</span><button className="icon-button small-icon" aria-label="Close details" onClick={() => setShowDetails(false)}><X size={17} /></button></div>
        <div className="contact-profile"><Avatar person={activeChat} size="profile" /><h2>{activeChat.name}</h2><p>{activeChat.role}</p><span className="profile-status"><span className={activeChat.online ? 'status-dot' : 'status-dot status-dot--away'} />{activeChat.online ? 'Online now' : 'Offline'}</span></div>
        <div className="profile-actions"><button onClick={() => showNotice(`Starting a call with ${activeChat.name}…`)}><Phone size={17} />Call</button><button onClick={() => showNotice(`Starting a video call with ${activeChat.name}…`)}><Video size={18} />Video</button></div>
        <div className="details-section"><button className="details-section-title" onClick={() => showNotice('No shared media yet.')}><span>Shared media</span><span>0</span><ChevronDown size={15} /></button><div className="media-empty"><Image size={18} /><span>No shared media yet</span></div></div>
        <div className="details-section details-section--files"><button className="details-section-title" onClick={() => showNotice('No shared files yet.')}><span>Shared files</span><span>0</span><ChevronDown size={15} /></button><div className="media-empty"><FileText size={18} /><span>No shared files yet</span></div></div>
        <div className="details-note"><Bell size={16} /><span>Notifications are on</span><Check size={15} /></div>
      </aside>}

      {notice && <div className="toast" role="status"><CheckCheck size={17} />{notice}<button aria-label="Dismiss" onClick={() => setNotice('')}><X size={15} /></button></div>}
      {requestInboxOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setRequestInboxOpen(false) }}><section className="new-chat-modal request-inbox-modal" role="dialog" aria-modal="true" aria-labelledby="request-inbox-title"><div className="modal-heading"><span><span className="modal-icon"><Mail size={17} /></span><strong id="request-inbox-title">Conversation requests</strong></span><button type="button" className="icon-button small-icon" aria-label="Close" onClick={() => setRequestInboxOpen(false)}><X size={18} /></button></div><h3 className="request-section-title">Received</h3>{requests.incoming.length ? <div className="request-list">{requests.incoming.map((request) => <article className="request-card" key={request.id}><Avatar person={request} size="message" /><div className="request-card-copy"><strong>{request.name}</strong><span>{request.email}</span><small>Wants to start a conversation</small></div><div className="request-card-actions"><button type="button" onClick={() => void acceptRequest(request)}>Accept</button><button type="button" onClick={() => void declineRequest(request)}>Decline</button></div></article>)}</div> : <p className="request-empty">No received requests.</p>}<h3 className="request-section-title request-section-title--sent">Sent</h3>{requests.outgoing.length ? <div className="request-list">{requests.outgoing.map((request) => <article className="request-card request-card--sent" key={request.id}><Avatar person={request} size="message" /><div className="request-card-copy"><strong>{request.name}</strong><span>{request.email}</span><small>Waiting for them to accept</small></div></article>)}</div> : <p className="request-empty">No pending sent requests.</p>}</section></div>}
      {newChatOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setNewChatOpen(false) }}><form className="new-chat-modal" onSubmit={createConversation}><div className="modal-heading"><span><span className="modal-icon"><Plus size={17} /></span><strong>Send a conversation request</strong></span><button type="button" className="icon-button small-icon" aria-label="Close" onClick={() => setNewChatOpen(false)}><X size={18} /></button></div><p className="request-modal-copy">They’ll need to accept your request before you can chat.</p><label htmlFor="new-chat-email">Email address of a Morrow member</label><input id="new-chat-email" type="email" autoFocus placeholder="teammate@company.com" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} required /><button className="create-chat-button" type="submit" disabled={!newEmail.trim() || requestBusy}>{requestBusy ? 'Sending request…' : 'Send request'}<ArrowDown className="create-arrow" size={15} /></button></form></div>}
    </main>
  )
}

export default App
