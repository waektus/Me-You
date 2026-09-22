import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import './couple-quest.css'

type Page = 'quests' | 'gallery' | 'shop'
type Tab = 'incoming' | 'sent' | 'review' | 'done'
type QuestStatus = 'pending' | 'review' | 'completed'
type VerifyType = 'review' | 'instant'
type QuestType = 'normal' | 'photo'
type QuestMode = 'solo' | 'couple'

type User = {
  id: number
  name: string
  stars: number
  createdAt: string
}

type RewardRedemption = {
  id: number
  userId: number
  reward: string
  cost: number
  createdAt: string
}

const REWARD_COST = 30

type Quest = {
  id: number
  title: string
  description: string | null
  icon: string
  questType: QuestType
  questMode: QuestMode
  senderCompleted: boolean
  receiverCompleted: boolean
  photoUrl: string | null
  photoSubmittedAt: string | null
  requirePhotoReason: boolean
  photoReason: string | null
  due: string
  points: number
  verifyType: VerifyType
  status: QuestStatus
  senderId: number
  receiverId: number
  createdAt: string
}

const API_ORIGIN =
  import.meta.env.VITE_API_ORIGIN?.replace(/\/$/, '') ||
  'http://localhost:3001'

const API = `${API_ORIGIN}/api`
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i)
  }

  return outputArray
}

const PRESET_ICONS = [
  '🎯',
  '⭐',
  '🌙',
  '❤️',
  '✨',
  '📖',
  '🎮',
  '🍜',
  '💧',
  '🚶',
  '💪',
  '🎵',
  '📷',
  '📸',
  '🌄',
  '🌅',
  '🌌',
  '🌿',
  '🌸',
]

export default function App() {
  
  const [page, setPage] = useState<Page>('quests')
  const [users, setUsers] = useState<User[]>([])
  const [quests, setQuests] = useState<Quest[]>([])
  const [currentUserId, setCurrentUserId] = useState<number | null>(null)
  const [tab, setTab] = useState<Tab>('incoming')

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [switchMessage, setSwitchMessage] = useState('')
  const [starBurstId, setStarBurstId] = useState(0)
  const [uploadingQuestId, setUploadingQuestId] = useState<number | null>(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('🎯')
  const [customIconOpen, setCustomIconOpen] = useState(false)
  const [questType, setQuestType] = useState<QuestType>('normal')
  const [questMode, setQuestMode] = useState<QuestMode>('solo')
  const [requirePhotoReason, setRequirePhotoReason] = useState(false)
  const [due, setDue] = useState('')
  const [points, setPoints] = useState(1)
  const [verifyType, setVerifyType] = useState<VerifyType>('review')

  const [photoQuest, setPhotoQuest] = useState<Quest | null>(null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoReason, setPhotoReason] = useState('')
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('')

  const [rewards, setRewards] = useState<RewardRedemption[]>([])
  const [rewardModalOpen, setRewardModalOpen] = useState(false)
  const [rewardText, setRewardText] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [isServerWaking, setIsServerWaking] = useState(false)
  const [enablingNotifications, setEnablingNotifications] = useState(false)
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermission>(() =>
      typeof Notification === 'undefined' ? 'default' : Notification.permission,
    )

  const currentUser = users.find((user) => user.id === currentUserId)
  const otherUser = users.find((user) => user.id !== currentUserId)

  function getUserName(id: number) {
    return users.find((user) => user.id === id)?.name ?? 'ไม่ทราบชื่อ'
  }

  async function loadData() {
    try {
      const [usersResponse, questsResponse, rewardsResponse] = await Promise.all([
        fetch(`${API}/users`),
        fetch(`${API}/quests`),
        fetch(`${API}/rewards`),
      ])

      if (!usersResponse.ok || !questsResponse.ok || !rewardsResponse.ok) {
        throw new Error('โหลดข้อมูลไม่สำเร็จ')
      }

      const usersData: User[] = await usersResponse.json()
      const questsData: Quest[] = await questsResponse.json()
      const rewardsData: RewardRedemption[] = await rewardsResponse.json()

      setUsers(usersData)
      setQuests(questsData)
      setRewards(rewardsData)

      setCurrentUserId((current) => {
        if (current !== null) return current
        return usersData[0]?.id ?? null
      })
    } catch (error) {
      console.error(error)
      showToast('โหลดข้อมูลไม่สำเร็จ')
    }
  }

  useEffect(() => {
    let active = true

    const wakeTimer = window.setTimeout(() => {
      if (active) {
        setIsServerWaking(true)
      }
    }, 1200)

    void loadData().finally(() => {
      if (!active) return

      window.clearTimeout(wakeTimer)
      setIsServerWaking(false)
      setIsInitialLoading(false)
    })

    return () => {
      active = false
      window.clearTimeout(wakeTimer)
    }
  }, [])

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return

      if (rewardModalOpen) {
        closeRewardModal()
        return
      }

      if (photoQuest) {
        closePhotoSubmitModal()
        return
      }

      closeModal()
    }

    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [photoQuest, rewardModalOpen])

  useEffect(() => {
    if (!switchMessage) return

    const timer = window.setTimeout(() => {
      setSwitchMessage('')
    }, 2000)

    return () => {
      window.clearTimeout(timer)
    }
  }, [switchMessage])

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreviewUrl('')
      return
    }

    const objectUrl = URL.createObjectURL(photoFile)
    setPhotoPreviewUrl(objectUrl)

    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [photoFile])

  const filteredQuests = useMemo(() => {
    if (currentUserId === null) return []

    return quests.filter((quest) => {
      const isParticipant =
        quest.senderId === currentUserId || quest.receiverId === currentUserId

      if (tab === 'incoming') {
        if (quest.questMode === 'couple') {
          return isParticipant && quest.status === 'pending'
        }

        return quest.receiverId === currentUserId && quest.status === 'pending'
      }

      if (tab === 'sent') {
        if (quest.questMode === 'couple') return false
        return quest.senderId === currentUserId && quest.status !== 'completed'
      }

      if (tab === 'review') {
        if (quest.questMode === 'couple') return false
        return quest.senderId === currentUserId && quest.status === 'review'
      }

      return quest.status === 'completed' && isParticipant
    })
  }, [quests, currentUserId, tab])

  function getDayKey(dateString: string) {
    const date = new Date(dateString)

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date)

    const year = parts.find((part) => part.type === 'year')?.value
    const month = parts.find((part) => part.type === 'month')?.value
    const day = parts.find((part) => part.type === 'day')?.value

    return `${year}-${month}-${day}`
  }

  const galleryGroups = useMemo(() => {
    const groups = new Map<string, Quest[]>()

    quests
      .filter(
        (quest) =>
          quest.questType === 'photo' &&
          Boolean(quest.photoUrl) &&
          Boolean(quest.photoSubmittedAt),
      )
      .forEach((quest) => {
        const key = getDayKey(quest.photoSubmittedAt!)
        const items = groups.get(key) ?? []
        items.push(quest)
        groups.set(key, items)
      })

    return Array.from(groups.entries())
      .sort(([dateA], [dateB]) => dateB.localeCompare(dateA))
      .map(([date, items]) => ({
        date,
        items: items.sort(
          (a, b) =>
            new Date(b.photoSubmittedAt!).getTime() -
            new Date(a.photoSubmittedAt!).getTime(),
        ),
      }))
  }, [quests])

  const sectionTitles: Record<Tab, string> = {
    incoming: 'เควสที่ต้องทำ',
    sent: 'เควสที่ส่งไปแล้ว',
    review: 'เควสที่รอตรวจ',
    done: 'เควสที่สำเร็จ',
  }

  function niceDate(date: string) {
    const today = new Date().toISOString().slice(0, 10)

    if (date === today) return 'วันนี้'

    return new Date(`${date}T00:00:00`).toLocaleDateString('th-TH', {
      day: 'numeric',
      month: 'short',
    })
  }

  function formatGalleryDate(date: string) {
    return new Date(`${date}T00:00:00+07:00`).toLocaleDateString('th-TH', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }

  function getPhotoUrl(url: string) {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url
    }

    return `${API_ORIGIN}${url}`
  }

  function showToast(message: string) {
    setToastMessage(message)

    window.setTimeout(() => {
      setToastMessage('')
    }, 2200)
  }

  function playStarBurst() {
    setStarBurstId((current) => current + 1)
  }

  function openModal() {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)

    setDue(tomorrow.toISOString().slice(0, 10))
    setIsModalOpen(true)

    window.setTimeout(() => {
      document.getElementById('title')?.focus()
    }, 50)
  }

  function closeModal() {
    setIsModalOpen(false)
    setTitle('')
    setDescription('')
    setIcon('🎯')
    setCustomIconOpen(false)
    setQuestType('normal')
    setQuestMode('solo')
    setRequirePhotoReason(false)
    setDue('')
    setPoints(1)
    setVerifyType('review')
  }

  function closePhotoSubmitModal() {
    setPhotoQuest(null)
    setPhotoFile(null)
    setPhotoReason('')
  }

  function choosePhotoForQuest(quest: Quest, file: File) {
    setPhotoQuest(quest)
    setPhotoFile(file)
    setPhotoReason('')
  }

  function closeRewardModal() {
    setRewardModalOpen(false)
    setRewardText('')
  }

  async function savePushSubscription(userId: number, subscription: PushSubscription) {
    const response = await fetch(`${API}/notifications/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId,
        subscription: subscription.toJSON(),
      }),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      throw new Error(data?.error ?? 'บันทึกการแจ้งเตือนไม่สำเร็จ')
    }
  }

  async function syncPushSubscription(userId: number) {
    if (
      typeof Notification === 'undefined' ||
      !('serviceWorker' in navigator) ||
      Notification.permission !== 'granted'
    ) {
      return
    }

    try {
      const registration = await navigator.serviceWorker.register('/sw.js')
      const subscription = await registration.pushManager.getSubscription()

      if (subscription) {
        await savePushSubscription(userId, subscription)
      }
    } catch (error) {
      console.error('sync push subscription failed', error)
    }
  }

  async function enableNotifications() {
    if (!currentUser || enablingNotifications) return

    if (
      typeof Notification === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window)
    ) {
      showToast('เบราว์เซอร์นี้ยังไม่รองรับ Web Push')
      return
    }

    if (!VAPID_PUBLIC_KEY) {
      showToast('ยังไม่ได้ตั้ง VITE_VAPID_PUBLIC_KEY')
      return
    }

    try {
      setEnablingNotifications(true)

      const permission = await Notification.requestPermission()
      setNotificationPermission(permission)

      if (permission !== 'granted') {
        showToast('ยังไม่ได้อนุญาตการแจ้งเตือน')
        return
      }

      const registration = await navigator.serviceWorker.register('/sw.js')
      let subscription = await registration.pushManager.getSubscription()

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        })
      }

      await savePushSubscription(currentUser.id, subscription)
      showToast(`เปิดแจ้งเตือนสำหรับ ${currentUser.name} แล้ว 🔔`)
    } catch (error) {
      console.error(error)
      showToast(error instanceof Error ? error.message : 'เปิดแจ้งเตือนไม่สำเร็จ')
    } finally {
      setEnablingNotifications(false)
    }
  }

  async function createQuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!currentUser || !otherUser) {
      showToast('ยังไม่มีผู้ใช้งานครบ 2 คน')
      return
    }

    try {
      const response = await fetch(`${API}/quests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          icon:
            icon.trim() ||
            (questMode === 'couple'
              ? '💞'
              : questType === 'photo'
                ? '📷'
                : '🎯'),
          questType: questMode === 'couple' ? 'normal' : questType,
          questMode,
          requirePhotoReason:
            questMode === 'solo' && questType === 'photo'
              ? requirePhotoReason
              : false,
          due,
          points,
          verifyType: questMode === 'couple' ? 'instant' : verifyType,
          senderId: currentUser.id,
          receiverId: otherUser.id,
        }),
      })

      if (!response.ok) {
        throw new Error('สร้าง Quest ไม่สำเร็จ')
      }

      const newQuest: Quest = await response.json()

      setQuests((current) => [newQuest, ...current])
      closeModal()

      if (newQuest.questMode === 'couple') {
        setTab('incoming')
        showToast(`สร้าง Couple Quest กับ${otherUser.name}แล้ว 💞`)
      } else {
        setTab('sent')
        showToast(`ส่งเควสให้${otherUser.name}แล้ว`)
      }
    } catch (error) {
      console.error(error)
      showToast('ส่งเควสไม่สำเร็จ')
    }
  }

  function isCurrentUserDoneWithCoupleQuest(quest: Quest) {
    if (currentUserId === null) return false

    if (quest.senderId === currentUserId) {
      return quest.senderCompleted
    }

    if (quest.receiverId === currentUserId) {
      return quest.receiverCompleted
    }

    return false
  }

  async function completeCoupleQuest(quest: Quest) {
    if (!currentUser) return

    try {
      const response = await fetch(`${API}/quests/${quest.id}/couple-complete`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: currentUser.id,
        }),
      })

      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(data?.error ?? 'ยืนยัน Couple Quest ไม่สำเร็จ')
      }

      if (data?.completed) {
        playStarBurst()
        showToast(`Couple Quest สำเร็จ! ทั้งคู่ได้รับ ${quest.points} ดาว 💞⭐`)
      } else {
        showToast('ทำส่วนของคุณแล้ว รออีกฝ่ายนะ 💞')
      }

      await loadData()
    } catch (error) {
      console.error(error)
      showToast(error instanceof Error ? error.message : 'ยืนยัน Couple Quest ไม่สำเร็จ')
    }
  }

  async function completeQuest(quest: Quest) {
    try {
      const response = await fetch(`${API}/quests/${quest.id}/complete`, {
        method: 'PATCH',
      })

      if (!response.ok) {
        throw new Error('ทำ Quest ไม่สำเร็จ')
      }

      if (quest.verifyType === 'instant') {
        playStarBurst()
        showToast(`สำเร็จ! ได้รับ ${quest.points} ดาว ⭐`)
      } else {
        showToast('ส่งให้อีกฝ่ายตรวจแล้ว')
      }

      await loadData()
    } catch (error) {
      console.error(error)
      showToast('เกิดข้อผิดพลาด')
    }
  }

  async function submitPhotoQuest(
    quest: Quest,
    file: File,
    reason: string,
  ) {
    try {
      setUploadingQuestId(quest.id)

      const formData = new FormData()
      formData.append('photo', file)
      formData.append('photoReason', reason.trim())

      const response = await fetch(`${API}/quests/${quest.id}/photo`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error ?? 'ส่งรูปไม่สำเร็จ')
      }

      closePhotoSubmitModal()

      if (quest.verifyType === 'instant') {
        playStarBurst()
        showToast(`ส่งรูปสำเร็จ ได้รับ ${quest.points} ดาว 📷⭐`)
      } else {
        showToast('ส่งรูปให้อีกฝ่ายดูแล้ว 📷')
      }

      await loadData()
    } catch (error) {
      console.error(error)
      showToast(error instanceof Error ? error.message : 'อัปโหลดรูปไม่สำเร็จ')
    } finally {
      setUploadingQuestId(null)
    }
  }

  async function approveQuest(quest: Quest) {
    try {
      const response = await fetch(`${API}/quests/${quest.id}/approve`, {
        method: 'PATCH',
      })

      if (!response.ok) {
        throw new Error('อนุมัติไม่สำเร็จ')
      }

      playStarBurst()
      showToast('อนุมัติเควสแล้ว ⭐')
      await loadData()
    } catch (error) {
      console.error(error)
      showToast('เกิดข้อผิดพลาด')
    }
  }

  async function redeemReward() {
    if (!currentUser || !rewardText.trim() || redeeming) return

    if (currentUser.stars < REWARD_COST) {
      showToast(`ต้องมีอย่างน้อย ${REWARD_COST} ดาว ⭐`)
      return
    }

    try {
      setRedeeming(true)

      const reward = rewardText.trim()

      const response = await fetch(`${API}/rewards/redeem`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: currentUser.id,
          reward,
        }),
      })

      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(data?.error ?? 'แลกรางวัลไม่สำเร็จ')
      }

      closeRewardModal()
      playStarBurst()
      showToast(`แลกรางวัล “${reward}” แล้ว 🎁`)
      await loadData()
    } catch (error) {
      console.error(error)
      showToast(error instanceof Error ? error.message : 'แลกรางวัลไม่สำเร็จ')
    } finally {
      setRedeeming(false)
    }
  }

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'อรุณสวัสดิ์' : 'สวัสดี'
  const stars = currentUser?.stars ?? 0
  const progress = Math.min(100, (stars % 10) * 10)
  const rewardProgress = Math.min(100, (stars / REWARD_COST) * 100)

  return (
    <>
      {isInitialLoading && (
        <div className="server-wakeup" role="status" aria-live="polite">
          <div className="server-wakeup-card">
            <div className="server-wakeup-spinner" aria-hidden="true" />
            <strong>
              {isServerWaking ? 'กำลังปลุกเซิร์ฟเวอร์...' : 'กำลังโหลดข้อมูล...'}
            </strong>
            {isServerWaking && (
              <small>ครั้งแรกอาจใช้เวลาสักครู่ เดี๋ยวก็มาแล้ว ☕</small>
            )}
          </div>
        </div>
      )}

      <div className="shell">
        <header className="topbar">
          <button
            type="button"
            className="brand brand-button"
            onClick={() => setPage('quests')}
          >
            <div className="logo">★</div>
            Me & You
          </button>

          <nav className="main-nav">
            <button
              type="button"
              className={`nav-link ${page === 'quests' ? 'active' : ''}`}
              onClick={() => setPage('quests')}
            >
              Quest
            </button>

            <button
              type="button"
              className={`nav-link ${page === 'gallery' ? 'active' : ''}`}
              onClick={() => setPage('gallery')}
            >
              Gallery
            </button>

            <button
              type="button"
              className={`nav-link ${page === 'shop' ? 'active' : ''}`}
              onClick={() => setPage('shop')}
            >
              Reward
            </button>
          </nav>

          <button
            type="button"
            className={`notification-toggle ${
              notificationPermission === 'granted' ? 'enabled' : ''
            }`}
            onClick={() => void enableNotifications()}
            disabled={!currentUser || enablingNotifications}
            title={
              notificationPermission === 'granted'
                ? `แจ้งเตือนสำหรับ ${currentUser?.name ?? ''}`
                : 'เปิดการแจ้งเตือน'
            }
          >
            {enablingNotifications
              ? 'กำลังเปิด...'
              : notificationPermission === 'granted'
                ? '🔔 เปิดแล้ว'
                : '🔕 เปิดแจ้งเตือน'}
          </button>

          <label className="switcher">
            <span>กำลังใช้งานเป็น</span>

            <select
              id="userSwitch"
              aria-label="เลือกผู้ใช้งาน"
              value={currentUserId ?? ''}
              onChange={(event) => {
                const userId = Number(event.target.value)
                setCurrentUserId(userId)
                setTab('incoming')
                void syncPushSubscription(userId)

                const selectedUser = users.find((user) => user.id === userId)

                if (selectedUser?.name === 'คนพิเศษ') {
                  setSwitchMessage('แอบมาทำอะไรหนะครับ 👀')
                } else {
                  setSwitchMessage('')
                }
              }}
            >
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
        </header>

        {page === 'quests' && (
          <>
            <section className="hero">
              <div className="welcome">
                <div className="eyebrow">เควสของเราสองคน</div>

                <h1 id="greeting">
                  {switchMessage
                    ? switchMessage
                    : `${greeting} ${currentUser?.name ?? ''} 👋`}
                </h1>

                <p>
                  ทำภารกิจเล็ก ๆ ให้สำเร็จ แล้วเก็บความทรงจำไปด้วยกัน
                </p>
              </div>

              <div className="score">
                <div>
                  <span>ดาวสะสมของคุณ</span>

                  <strong>
                    <b id="stars">{stars}</b>{' '}
                    <small>ดาว</small>
                  </strong>

                  <div className="progress">
                    <i id="progress" style={{ width: `${progress}%` }} />
                  </div>
                </div>

                <div className="star">★</div>
              </div>
            </section>

            <div className="toolbar">
              <nav className="tabs" aria-label="หมวดเควส">
                <button
                  className={`tab ${tab === 'incoming' ? 'active' : ''}`}
                  onClick={() => setTab('incoming')}
                >
                  ต้องทำ
                </button>

                <button
                  className={`tab ${tab === 'sent' ? 'active' : ''}`}
                  onClick={() => setTab('sent')}
                >
                  ส่งไปแล้ว
                </button>

                <button
                  className={`tab ${tab === 'review' ? 'active' : ''}`}
                  onClick={() => setTab('review')}
                >
                  รอตรวจ
                </button>

                <button
                  className={`tab ${tab === 'done' ? 'active' : ''}`}
                  onClick={() => setTab('done')}
                >
                  สำเร็จ
                </button>
              </nav>

              <button className="primary" id="newQuest" onClick={openModal}>
                ＋ ส่งเควสใหม่
              </button>
            </div>

            <div className="section-head">
              <h2>{sectionTitles[tab]}</h2>
              <small>{filteredQuests.length} เควส</small>
            </div>

            <main className="grid" id="questGrid">
              {filteredQuests.length === 0 ? (
                <div className="empty">
                  <div className="empty-icon">✓</div>
                  ไม่มีเควสในหมวดนี้
                </div>
              ) : (
                filteredQuests.map((quest, index) => (
                  <article
                    className="quest"
                    key={quest.id}
                    style={{ animationDelay: `${index * 70}ms` }}
                  >
                    <div className="qicon">
                      {quest.icon ||
                        (quest.questMode === 'couple'
                          ? '💞'
                          : quest.questType === 'photo'
                            ? '📷'
                            : '🎯')}
                    </div>

                    <div className="qbody">
                      <div className="qtop">
                        <div>
                          <h3>{quest.title}</h3>
                          <div className="desc">
                            {quest.description || 'ไม่มีรายละเอียด'}
                          </div>
                        </div>

                        <div className="points">
                          {quest.questMode === 'couple'
                            ? `ทั้งคู่ +${quest.points} ★`
                            : `+${quest.points} ★`}
                        </div>
                      </div>

                      {quest.questMode === 'couple' && (
                        <div className="couple-quest-panel">
                          <div className="couple-quest-label">💞 Couple Quest</div>

                          <div className="couple-progress-list">
                            <div className={quest.senderCompleted ? 'done' : ''}>
                              <span>{getUserName(quest.senderId)}</span>
                              <strong>{quest.senderCompleted ? '✓ ทำแล้ว' : 'รอทำ'}</strong>
                            </div>

                            <div className={quest.receiverCompleted ? 'done' : ''}>
                              <span>{getUserName(quest.receiverId)}</span>
                              <strong>{quest.receiverCompleted ? '✓ ทำแล้ว' : 'รอทำ'}</strong>
                            </div>
                          </div>
                        </div>
                      )}

                      {quest.questType === 'photo' && quest.questMode === 'solo' && (
                        <div className="photo-quest-label">
                          📷 เควสถ่ายภาพ
                          {quest.requirePhotoReason ? ' · 💭 ต้องอธิบายเหตุผล' : ''}
                        </div>
                      )}

                      {quest.photoUrl && (
                        <a
                          href={getPhotoUrl(quest.photoUrl)}
                          target="_blank"
                          rel="noreferrer"
                          className="quest-photo-preview"
                        >
                          <img
                            src={getPhotoUrl(quest.photoUrl)}
                            alt={quest.title}
                          />
                        </a>
                      )}

                      {quest.photoReason && (
                        <div className="quest-photo-reason">
                          <span>💭</span>
                          <p>{quest.photoReason}</p>
                        </div>
                      )}

                      <div className="meta">
                        {quest.status === 'review' ? (
                          <span className="badge blue">รอตรวจ</span>
                        ) : quest.status === 'completed' ? (
                          <span className="badge green">สำเร็จแล้ว</span>
                        ) : (
                          <span className="badge">
                            ครบกำหนด {niceDate(quest.due)}
                          </span>
                        )}

                        {tab === 'incoming' && quest.questMode === 'couple' && (
                          isCurrentUserDoneWithCoupleQuest(quest) ? (
                            <span className="couple-done-chip">✓ คุณทำแล้ว · รออีกฝ่าย</span>
                          ) : (
                            <button
                              className="action couple-action"
                              onClick={() => void completeCoupleQuest(quest)}
                            >
                              💞 ทำแล้วน้าาาา
                            </button>
                          )
                        )}

                        {tab === 'incoming' &&
                          quest.questMode === 'solo' &&
                          quest.questType === 'normal' && (
                            <button
                              className="action"
                              onClick={() => void completeQuest(quest)}
                            >
                              ทำเสร็จแล้ว
                            </button>
                          )}

                        {tab === 'incoming' &&
                          quest.questMode === 'solo' &&
                          quest.questType === 'photo' && (
                          <label
                            className={`action photo-submit ${
                              uploadingQuestId === quest.id ? 'disabled' : ''
                            }`}
                          >
                            {uploadingQuestId === quest.id
                              ? 'กำลังอัปโหลด...'
                              : '📷 ถ่าย / เลือกรูป'}

                            <input
                              type="file"
                              accept="image/*"
                              hidden
                              disabled={uploadingQuestId === quest.id}
                              onChange={(event) => {
                                const file = event.target.files?.[0]

                                if (file) {
                                  choosePhotoForQuest(quest, file)
                                }

                                event.currentTarget.value = ''
                              }}
                            />
                          </label>
                        )}

                        {tab === 'review' && quest.questMode === 'solo' && (
                          <button
                            className="action"
                            onClick={() => void approveQuest(quest)}
                          >
                            อนุมัติ +{quest.points} ★
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                ))
              )}
            </main>
          </>
        )}

        {page === 'gallery' && (
          <main className="gallery-page">
            <section className="gallery-hero">
              <div className="eyebrow">Our memories</div>
              <h1>Gallery ของเรา</h1>
              <p>รูปจากเควสถ่ายภาพจะถูกรวมไว้ที่นี่ แยกตามแต่ละวัน</p>
            </section>

            {galleryGroups.length === 0 ? (
              <div className="gallery-empty">
                <div>📷</div>
                <h2>ยังไม่มีรูป</h2>
                <p>ลองสร้างเควสถ่ายภาพแรกของเราดู</p>

                <button
                  className="primary"
                  onClick={() => {
                    setPage('quests')
                    setQuestType('photo')
                    setIcon('📷')
                    openModal()
                  }}
                >
                  ＋ สร้างเควสถ่ายภาพ
                </button>
              </div>
            ) : (
              galleryGroups.map((group) => (
                <section className="gallery-day" key={group.date}>
                  <div className="gallery-day-head">
                    <div>
                      <h2>{formatGalleryDate(group.date)}</h2>
                    </div>

                    <small>{group.items.length} รูป</small>
                  </div>

                  <div className="gallery-grid">
                    {group.items.map((quest) => (
                      <article className="gallery-card" key={quest.id}>
                        <a
                          className="gallery-image-wrap"
                          href={getPhotoUrl(quest.photoUrl!)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <img
                            className="gallery-image"
                            src={getPhotoUrl(quest.photoUrl!)}
                            alt={quest.title}
                          />
                        </a>

                        <div className="gallery-info">
                          <div className="gallery-title">
                            <span>{quest.icon || '📷'}</span>
                            <h3>{quest.title}</h3>
                          </div>

                          {quest.description && <p>{quest.description}</p>}

                          {quest.photoReason && (
                            <div className="gallery-reason">
                              <span>💭</span>
                              <p>{quest.photoReason}</p>
                            </div>
                          )}

                          <div className="gallery-meta">
                            <span>โดย {getUserName(quest.receiverId)}</span>

                            {quest.status === 'review' ? (
                              <span className="badge blue">รอตรวจ</span>
                            ) : (
                              <span className="badge green">สำเร็จ</span>
                            )}
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))
            )}
          </main>
        )}

        {page === 'shop' && (
          <main className="reward-page">
            <section className="reward-hero">
              <div className="reward-hero-icon">🎁</div>

              <div>
                <div className="eyebrow">A little reward</div>
                <h1>รางวัลของคนเก่งที่สุดในจักรวาลล!!</h1>
                <p>สะสมให้ครบ 30 ดาว แล้วเลือกเองได้เลยว่าอยากได้อะไร q(≧▽≦q)</p>
              </div>
            </section>

            <section className="reward-status">
              <div className="reward-stars">
                <span>ดาวตอนนี้</span>
                <strong>{stars} ★</strong>
              </div>

              <div className="reward-progress" aria-label={`สะสม ${stars} จาก ${REWARD_COST} ดาว`}>
                <i style={{ width: `${rewardProgress}%` }} />
              </div>

              {stars >= REWARD_COST ? (
                <div className="reward-unlocked">
                  <h2>ปลดล็อกรางวัลแล้ว!</h2>
                  <p>ครบ 30 ดาวแล้ว อยากได้อะไรก็เขียนเองได้เลย</p>

                  <button
                    type="button"
                    className="primary reward-redeem-button"
                    onClick={() => setRewardModalOpen(true)}
                  >
                    แลก 30 ดาว
                  </button>
                </div>
              ) : (
                <div className="reward-locked">
                  <div className="reward-lock-icon">🔒</div>

                  <div>
                    <strong>อีก {REWARD_COST - stars} ดาว</strong>
                    <p>ก็จะเลือกรางวัลได้แล้วววพยายามเข้า!</p>
                  </div>
                </div>
              )}
            </section>

            <section className="reward-history">
              <div className="section-head">
                <h2>ประวัติรางวัล</h2>
                <small>{rewards.length} ครั้ง</small>
              </div>

              {rewards.length === 0 ? (
                <div className="reward-history-empty">
                  <div>🎀</div>
                  ยังไม่เคยแลกรางวัล
                </div>
              ) : (
                <div className="reward-history-list">
                  {rewards.map((reward) => (
                    <article className="reward-history-card" key={reward.id}>
                      <div className="reward-history-icon">🎁</div>

                      <div className="reward-history-body">
                        <strong>{reward.reward}</strong>
                        <span>โดย {getUserName(reward.userId)}</span>
                        <small>
                          {new Date(reward.createdAt).toLocaleString('th-TH', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </small>
                      </div>

                      <div className="reward-history-cost">-{reward.cost} ★</div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </main>
        )}
      </div>

      <div
        className={`overlay ${isModalOpen ? 'open' : ''}`}
        id="overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modalTitle"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            closeModal()
          }
        }}
      >
        <form className="modal" id="questForm" onSubmit={createQuest}>
          <div className="modal-head">
            <h2 id="modalTitle">ส่งเควสใหม่</h2>

            <button
              type="button"
              className="icon-btn"
              aria-label="ปิด"
              onClick={closeModal}
            >
              ×
            </button>
          </div>

          <div className="field">
            <label>รูปแบบเควส</label>

            <div className="quest-type-picker">
              <button
                type="button"
                className={`quest-type-option ${
                  questMode === 'solo' && questType === 'normal' ? 'selected' : ''
                }`}
                onClick={() => {
                  setQuestMode('solo')
                  setQuestType('normal')
                  setRequirePhotoReason(false)

                  if (icon === '📷' || icon === '💞') {
                    setIcon('🎯')
                  }
                }}
              >
                <span>🎯</span>
                <div>
                  <strong>เควสปกติ</strong>
                  <small>ภารกิจทั่วไป</small>
                </div>
              </button>

              <button
                type="button"
                className={`quest-type-option ${
                  questMode === 'solo' && questType === 'photo' ? 'selected' : ''
                }`}
                onClick={() => {
                  setQuestMode('solo')
                  setQuestType('photo')

                  if (icon === '🎯' || icon === '💞') {
                    setIcon('📷')
                  }
                }}
              >
                <span>📷</span>
                <div>
                  <strong>เควสถ่ายภาพ</strong>
                  <small>รูปจะเข้า Gallery</small>
                </div>
              </button>

              <button
                type="button"
                className={`quest-type-option ${
                  questMode === 'couple' ? 'selected' : ''
                }`}
                onClick={() => {
                  setQuestMode('couple')
                  setQuestType('normal')
                  setRequirePhotoReason(false)
                  setVerifyType('instant')
                  setIcon('💞')
                  setCustomIconOpen(false)
                }}
              >
                <span>💞</span>
                <div>
                  <strong>Couple Quest</strong>
                  <small>ทำพร้อมกันทั้งคู่</small>
                </div>
              </button>
            </div>

            {questMode === 'couple' && (
              <div className="couple-create-note">
                <strong>💞 ทั้งคู่ต้องกด “ทำแล้วน้าาาา”</strong>
                <small>เมื่อครบทั้งสองคน จะได้รับ {points} ดาวต่อคนอัตโนมัติ</small>
              </div>
            )}

            {questMode === 'solo' && questType === 'photo' && (
              <label className="photo-reason-option">
                <input
                  type="checkbox"
                  checked={requirePhotoReason}
                  onChange={(event) => {
                    setRequirePhotoReason(event.target.checked)
                  }}
                />

                <div>
                  <strong>💭 ให้อธิบายเหตุผลด้วย</strong>
                  <small>ให้เขียนว่าทำไมถึงเลือกถ่ายรูปนี้</small>
                </div>
              </label>
            )}
          </div>

          <div className="field">
            <label htmlFor="title">ชื่อเควส</label>

            <input
              id="title"
              required
              maxLength={60}
              placeholder={
                questMode === 'couple'
                  ? 'เช่น ไปเดินเล่นด้วยกัน 20 นาที'
                  : questType === 'photo'
                    ? 'เช่น ถ่ายรูปท้องฟ้าที่แสนสดใส'
                    : 'เช่น ดื่มน้ำให้ครบ 8 แก้ว'
              }
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="description">รายละเอียด</label>

            <textarea
              id="description"
              rows={3}
              maxLength={180}
              placeholder={
                questMode === 'couple'
                  ? 'เช่น ทำด้วยกัน แล้วกดเสร็จทั้งสองคนนะ'
                  : questType === 'photo'
                    ? 'เช่น ถ่ายวิวที่ชอบที่สุดระหว่างวันนี้'
                    : 'บอกสิ่งที่ต้องทำให้ชัดเจน'
              }
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="field">
            <label>ไอคอนเควส</label>

            <div className="icon-picker">
              {PRESET_ICONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={`icon-choice ${
                    icon === emoji && !customIconOpen ? 'selected' : ''
                  }`}
                  onClick={() => {
                    setIcon(emoji)
                    setCustomIconOpen(false)
                  }}
                >
                  {emoji}
                </button>
              ))}

              <button
                type="button"
                className={`icon-choice icon-custom ${
                  customIconOpen ? 'selected' : ''
                }`}
                onClick={() => {
                  setCustomIconOpen(true)

                  if (PRESET_ICONS.includes(icon)) {
                    setIcon('')
                  }
                }}
              >
                ＋
              </button>
            </div>

            {customIconOpen && (
              <div className="custom-icon-box">
                <span className="custom-icon-preview">{icon || '✨'}</span>

                <input
                  type="text"
                  value={icon}
                  maxLength={20}
                  placeholder="ใส่ emoji เช่น 🪐 เอาแค่อันเดียวนะครับ"
                  autoFocus
                  onChange={(event) => setIcon(event.target.value)}
                />
              </div>
            )}
          </div>

          <div className="row">
            <div className="field">
              <label htmlFor="due">กำหนดส่ง</label>

              <input
                id="due"
                type="date"
                required
                value={due}
                onChange={(event) => setDue(event.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="points">รางวัล</label>

              <select
                id="points"
                value={points}
                onChange={(event) => setPoints(Number(event.target.value))}
              >
                <option value={1}>★ 1 ดาว</option>
                <option value={3}>★★★ 3 ดาว</option>
                <option value={5}>★★★★★ 5 ดาว</option>
              </select>
            </div>
          </div>

          {questMode === 'solo' ? (
            <div className="field">
              <label htmlFor="verify">การยืนยัน</label>

              <select
                id="verify"
                value={verifyType}
                onChange={(event) => {
                  setVerifyType(event.target.value as VerifyType)
                }}
              >
                <option value="review">ให้อีกฝ่ายตรวจสอบ</option>
                <option value="instant">สำเร็จและรับดาวทันที</option>
              </select>
            </div>
          ) : (
            <div className="couple-verify-note">
              ✨ Couple Quest สำเร็จทันทีเมื่อทั้งสองคนกดยืนยันครบ
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="action" onClick={closeModal}>
              ยกเลิก
            </button>

            <button className="primary" type="submit">
              {questMode === 'couple'
                ? `สร้างกับ${otherUser?.name ?? 'คนพิเศษ'} 💞`
                : `ส่งให้${otherUser?.name ?? 'คนพิเศษ'}`}
            </button>
          </div>
        </form>
      </div>

      {photoQuest && photoFile && (
        <div
          className="photo-submit-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="photoSubmitTitle"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closePhotoSubmitModal()
            }
          }}
        >
          <div className="photo-submit-modal">
            <div className="modal-head">
              <div>
                <div className="photo-submit-eyebrow">เควสถ่ายภาพ</div>
                <h2 id="photoSubmitTitle">ส่งรูป</h2>
              </div>

              <button
                type="button"
                className="icon-btn"
                aria-label="ปิด"
                onClick={closePhotoSubmitModal}
              >
                ×
              </button>
            </div>

            {photoPreviewUrl && (
              <img
                className="photo-submit-preview"
                src={photoPreviewUrl}
                alt="รูปที่เลือก"
              />
            )}

            <div className="photo-submit-quest-name">
              <span>{photoQuest.icon || '📷'}</span>
              <div>
                <strong>{photoQuest.title}</strong>
                {photoQuest.description && <small>{photoQuest.description}</small>}
              </div>
            </div>

            {photoQuest.requirePhotoReason && (
              <div className="field photo-reason-field">
                <label htmlFor="photoReason">
                  ทำไมถึงเลือกรูปนี้?
                </label>

                <textarea
                  id="photoReason"
                  rows={4}
                  required
                  maxLength={300}
                  placeholder="เพราะว่า..."
                  value={photoReason}
                  onChange={(event) => setPhotoReason(event.target.value)}
                />

                <small className="photo-reason-count">
                  {photoReason.length}/300
                </small>
              </div>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="action"
                onClick={closePhotoSubmitModal}
                disabled={uploadingQuestId === photoQuest.id}
              >
                ยกเลิก
              </button>

              <button
                type="button"
                className="primary"
                disabled={
                  uploadingQuestId === photoQuest.id ||
                  (photoQuest.requirePhotoReason && !photoReason.trim())
                }
                onClick={() => {
                  void submitPhotoQuest(photoQuest, photoFile, photoReason)
                }}
              >
                {uploadingQuestId === photoQuest.id
                  ? 'กำลังส่ง...'
                  : 'ส่งรูป 📷'}
              </button>
            </div>
          </div>
        </div>
      )}

      {rewardModalOpen && (
        <div
          className="reward-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rewardModalTitle"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !redeeming) {
              closeRewardModal()
            }
          }}
        >
          <div className="reward-modal">
            <div className="modal-head">
              <div className="reward-modal-heading">
                <div className="reward-modal-emoji">🎁</div>
                <h2 id="rewardModalTitle">อยากได้อะไรเอ่ยย?</h2>
              </div>

              <button
                type="button"
                className="icon-btn"
                aria-label="ปิด"
                disabled={redeeming}
                onClick={closeRewardModal}
              >
                ×
              </button>
            </div>

            <p className="reward-modal-description">
              ใช้ 30 ★ แล้วเลือกสิ่งที่อยากได้เองได้เลย
            </p>

            <div className="field">
              <label htmlFor="reward">ของรางวัลที่อยากได้</label>

              <textarea
                id="reward"
                rows={4}
                maxLength={200}
                placeholder="เช่น อยากให้โรลย์เพลย์เป็นเป็ดน่ารัก"
                value={rewardText}
                autoFocus
                disabled={redeeming}
                onChange={(event) => setRewardText(event.target.value)}
              />

              <small className="reward-count">{rewardText.length}/200</small>
            </div>

            <div className="reward-confirm">
              <div>
                <span>ดาวตอนนี้</span>
                <strong>{stars} ★</strong>
              </div>

              <span className="reward-arrow">→</span>

              <div>
                <span>หลังแลก</span>
                <strong>{Math.max(0, stars - REWARD_COST)} ★</strong>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="action"
                disabled={redeeming}
                onClick={closeRewardModal}
              >
                ยังไม่เอา
              </button>

              <button
                type="button"
                className="primary"
                disabled={!rewardText.trim() || redeeming}
                onClick={() => void redeemReward()}
              >
                {redeeming ? 'กำลังแลก...' : 'แลก 30 ★'}
              </button>
            </div>
          </div>
        </div>
      )}

      {starBurstId > 0 && (
        <div className="star-rush" key={starBurstId} aria-hidden="true">
          <span>★</span>
          <span>★</span>
          <span>★</span>
          <span>★</span>
          <span>★</span>
          <span>★</span>
          <span>★</span>
          <span>★</span>
          <span>★</span>
        </div>
      )}

      <div
        className={`toast ${toastMessage ? 'show' : ''}`}
        id="toast"
        role="status"
      >
        {toastMessage}
      </div>
    </>
  )
}
