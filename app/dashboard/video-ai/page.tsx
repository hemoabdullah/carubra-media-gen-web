"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import {
  Loader2, Video, Sparkles, Share2, Trash2, Edit2, Send,
  Coins, Info, XCircle, CheckCircle2, Clock, LayoutGrid,
  History, Share2 as TwitterIcon, Camera as InstagramIcon, Users as FacebookIcon, Zap, Upload,
  Eye, Copy, Save, RotateCcw, AlertTriangle,
} from "lucide-react"
import { useLanguage } from "@/contexts/language-context"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"

// ─── Types ───────────────────────────────────────────────────────────────────

type VideoModel = "text-to-video" | "image-to-video"
type Resolution = "480p" | "720p" | "1080p" | "2K"
type ConnectedSocmed = "twitter" | "instagram" | "facebook"

type VideoItem = {
  id: string
  jobId?: string
  title: string
  script: string
  resolution: Resolution
  ratio: string
  model: VideoModel
  duration: number
  coinCost: number
  status: "completed" | "failed" | "generating"
  completedTime: number | null
  caption: string
  createdAt: Date
  videoUrl?: string
}

const resolutionCost: Record<Resolution, number> = { "480p": 2, "720p": 3, "1080p": 4, "2K": 5 }

const RATIO_OPTIONS = [
  { value: "1-1",  label: "Square",      ratio: "1:1",  tw: "aspect-square", w: 1,  h: 1  },
  { value: "9-16", label: "Vertical",    ratio: "9:16", tw: "aspect-[9/16]", w: 9,  h: 16 },
  { value: "16-9", label: "Widescreen",  ratio: "16:9", tw: "aspect-video",  w: 16, h: 9  },
  { value: "4-3",  label: "Standard",    ratio: "4:3",  tw: "aspect-[4/3]",  w: 4,  h: 3  },
  { value: "3-4",  label: "Portrait",    ratio: "3:4",  tw: "aspect-[3/4]",  w: 3,  h: 4  },
]

// ─── Detail Modal ─────────────────────────────────────────────────────────────

type DetailModalProps = {
  item: VideoItem | null
  open: boolean
  onClose: () => void
  onDelete: (id: string) => void
  onSave: (id: string, title: string, script: string, caption: string) => void
  onRegenCaption: (item: VideoItem, newScript: string) => Promise<void>
  onRegenVideo: (item: VideoItem, newScript: string) => Promise<void>
  connectedSocmed: ConnectedSocmed[]
  isRegenerating: boolean
  isCaptioning: boolean
}

function DetailModal({
  item, open, onClose, onDelete, onSave,
  onRegenCaption, onRegenVideo,
  connectedSocmed, isRegenerating, isCaptioning,
}: DetailModalProps) {
  const [editTitle, setEditTitle] = useState("")
  const [editScript, setEditScript] = useState("")
  const [editCaption, setEditCaption] = useState("")
  const [activeTab, setActiveTab] = useState<"view" | "edit">("view")
  const [shareSuccess, setShareSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (item) {
      console.log('[video-ai] DetailModal - received item prop:', {
        id: item.id,
        videoUrl: item.videoUrl,
        videoUrl_type: typeof item.videoUrl,
        videoUrl_length: item.videoUrl?.length,
        status: item.status,
      })
      setEditTitle(item.title)
      setEditScript(item.script)
      setEditCaption(item.caption)
      setActiveTab("view")
      setShareSuccess(null)
    }
  }, [item])

  if (!item) return null

  const handleSave = () => {
    onSave(item.id, editTitle, editScript, editCaption)
    setActiveTab("view")
  }

  const handleShare = (platform: ConnectedSocmed) => {
    setShareSuccess(platform)
    setTimeout(() => setShareSuccess(null), 2500)
  }

  const formatTime = (seconds: number | null) => {
    if (seconds === null) return "—"
    if (seconds < 60) return `${seconds} detik`
    return `${Math.floor(seconds / 60)} menit`
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl w-full p-0 overflow-hidden rounded-2xl gap-0">
        <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/30">
          <div className="flex items-center gap-3">
            <DialogTitle className="text-base font-semibold line-clamp-1 max-w-sm">
              {item.title}
            </DialogTitle>
            <Badge
              variant={item.status === "completed" ? "default" : item.status === "failed" ? "destructive" : "secondary"}
              className="text-xs gap-1 flex-shrink-0"
            >
              {item.status === "completed" && <CheckCircle2 className="h-3 w-3" />}
              {item.status === "failed" && <XCircle className="h-3 w-3" />}
              {item.status === "generating" && <Loader2 className="h-3 w-3 animate-spin" />}
              {item.status === "completed" ? "Selesai" : item.status === "failed" ? "Gagal" : "Proses..."}
            </Badge>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-0 max-h-[75vh] overflow-y-auto">
          {/* Left: Video Preview */}
          <div className="bg-black/10 dark:bg-black/40 flex items-center justify-center p-4 min-h-[280px]">
            {(() => {
              console.log('[video-ai] DetailModal - rendering video preview:', {
                hasVideoUrl: !!item.videoUrl,
                videoUrl: item.videoUrl,
                videoUrl_type: typeof item.videoUrl,
                videoUrl_length: item.videoUrl?.length,
                status: item.status,
              })
              return null
            })()}
            {item.videoUrl ? (
              <video src={item.videoUrl} controls className="rounded-xl w-full max-h-[420px] shadow-lg object-contain"
                onLoadStart={(e) => console.log('[VIDEO-DEBUG] loadstart', { src: e.currentTarget.currentSrc, network: e.currentTarget.networkState, ready: e.currentTarget.readyState })}
                onLoadedMetadata={(e) => console.log('[VIDEO-DEBUG] loadedmetadata', { src: e.currentTarget.currentSrc, vw: e.currentTarget.videoWidth, vh: e.currentTarget.videoHeight, dur: e.currentTarget.duration, network: e.currentTarget.networkState, ready: e.currentTarget.readyState })}
                onLoadedData={(e) => console.log('[VIDEO-DEBUG] loadeddata', { src: e.currentTarget.currentSrc, vw: e.currentTarget.videoWidth, vh: e.currentTarget.videoHeight, network: e.currentTarget.networkState, ready: e.currentTarget.readyState })}
                onCanPlay={(e) => console.log('[VIDEO-DEBUG] canplay', { src: e.currentTarget.currentSrc, vw: e.currentTarget.videoWidth, vh: e.currentTarget.videoHeight, network: e.currentTarget.networkState, ready: e.currentTarget.readyState })}
                onCanPlayThrough={(e) => console.log('[VIDEO-DEBUG] canplaythrough', { src: e.currentTarget.currentSrc })}
                onPlaying={(e) => console.log('[VIDEO-DEBUG] playing', { src: e.currentTarget.currentSrc, time: e.currentTarget.currentTime })}
                onError={(e) => console.log('[VIDEO-DEBUG] error', { src: e.currentTarget.currentSrc, code: e.currentTarget.error?.code, message: (e.currentTarget.error as any)?.message, network: e.currentTarget.networkState, ready: e.currentTarget.readyState })}
              />
            ) : item.status === "generating" ? (
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="text-sm">Membuat video...</p>
              </div>
            ) : item.status === "completed" ? (
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Video className="h-8 w-8 text-primary" />
                </div>
                <p className="text-sm text-center">Video berhasil dibuat</p>
                <p className="text-xs opacity-60 text-center">Preview tidak tersedia</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <XCircle className="h-10 w-10 opacity-30" />
                <p className="text-sm">Video gagal dibuat</p>
              </div>
            )}
          </div>

          {/* Right: Info + Actions */}
          <div className="flex flex-col p-5 gap-4 overflow-y-auto">
            <div className="flex rounded-lg bg-muted p-1 gap-1">
              <button onClick={() => setActiveTab("view")}
                className={cn("flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                  activeTab === "view" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                )}>
                <Eye className="h-3.5 w-3.5 inline mr-1.5" />Detail
              </button>
              <button onClick={() => setActiveTab("edit")}
                className={cn("flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                  activeTab === "edit" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                )}>
                <Edit2 className="h-3.5 w-3.5 inline mr-1.5" />Edit
              </button>
            </div>

            {activeTab === "view" && (
              <div className="flex flex-col gap-4 flex-1">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-muted/50 px-3 py-2">
                    <p className="text-muted-foreground mb-0.5">Model</p>
                    <p className="font-medium">{item.model === "text-to-video" ? "Text→Video" : "Image→Video"}</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 px-3 py-2">
                    <p className="text-muted-foreground mb-0.5">Resolusi</p>
                    <p className="font-medium">{item.resolution} · {item.ratio}</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 px-3 py-2">
                    <p className="text-muted-foreground mb-0.5">Durasi Video</p>
                    <p className="font-medium">{item.duration} detik</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 px-3 py-2">
                    <p className="text-muted-foreground mb-0.5">Waktu Generate</p>
                    <p className="font-medium">{formatTime(item.completedTime)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 px-3 py-2">
                    <p className="text-muted-foreground mb-0.5">Biaya</p>
                    <p className="font-medium">{item.coinCost} koin</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 px-3 py-2">
                    <p className="text-muted-foreground mb-0.5">Dibuat</p>
                    <p className="font-medium">{item.createdAt.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1.5">SCRIPT / DESKRIPSI</p>
                  <p className="text-sm leading-relaxed bg-muted/40 rounded-lg px-3 py-2">{item.script}</p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-xs font-semibold text-muted-foreground">CAPTION</p>
                    {item.caption && (
                      <button onClick={() => navigator.clipboard.writeText(item.caption)}
                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                        <Copy className="h-3 w-3" /> Copy
                      </button>
                    )}
                  </div>
                  <p className="text-sm leading-relaxed bg-muted/40 rounded-lg px-3 py-2 whitespace-pre-line">
                    {item.caption || (item.status === "generating" ? "Menyiapkan caption..." : "Tidak ada caption.")}
                  </p>
                </div>

                <div className="mt-auto flex flex-col gap-2">
                  {connectedSocmed.length > 0 && item.status === "completed" && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                        <Share2 className="h-3 w-3" /> BAGIKAN KE
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {connectedSocmed.includes("twitter") && (
                          <Button size="sm"
                            className={cn("gap-1.5 text-white border-0 transition-all text-xs h-8",
                              shareSuccess === "twitter" ? "bg-green-500" : "bg-sky-500 hover:bg-sky-600"
                            )}
                            onClick={() => handleShare("twitter")}>
                            {shareSuccess === "twitter" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <TwitterIcon className="h-3.5 w-3.5" />}
                            {shareSuccess === "twitter" ? "Dibagikan!" : "Twitter / X"}
                          </Button>
                        )}
                        {connectedSocmed.includes("instagram") && (
                          <Button size="sm"
                            className={cn("gap-1.5 text-white border-0 transition-all text-xs h-8",
                              shareSuccess === "instagram" ? "bg-green-500" : "bg-gradient-to-r from-pink-500 to-purple-600"
                            )}
                            onClick={() => handleShare("instagram")}>
                            {shareSuccess === "instagram" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <InstagramIcon className="h-3.5 w-3.5" />}
                            {shareSuccess === "instagram" ? "Dibagikan!" : "Instagram"}
                          </Button>
                        )}
                        {connectedSocmed.includes("facebook") && (
                          <Button size="sm"
                            className={cn("gap-1.5 text-white border-0 transition-all text-xs h-8",
                              shareSuccess === "facebook" ? "bg-green-500" : "bg-blue-600 hover:bg-blue-700"
                            )}
                            onClick={() => handleShare("facebook")}>
                            {shareSuccess === "facebook" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <FacebookIcon className="h-3.5 w-3.5" />}
                            {shareSuccess === "facebook" ? "Dibagikan!" : "Facebook"}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  <Button size="sm" variant="outline"
                    className="w-full gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
                    onClick={() => { onDelete(item.id); onClose() }}>
                    <Trash2 className="h-3.5 w-3.5" /> Hapus Video
                  </Button>
                </div>
              </div>
            )}

            {activeTab === "edit" && (
              <div className="flex flex-col gap-4 flex-1">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground">JUDUL VIDEO</Label>
                  <Input value={editTitle} onChange={e => setEditTitle(e.target.value)}
                    className="text-sm" placeholder="Edit judul video..." />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground">SCRIPT / DESKRIPSI</Label>
                  <Textarea value={editScript} onChange={e => setEditScript(e.target.value)}
                    rows={4} className="resize-none text-sm" placeholder="Edit script untuk generate ulang video..." />
                  <Button size="sm" variant="outline" className="w-full gap-1.5"
                    disabled={isRegenerating || !editScript.trim()}
                    onClick={() => onRegenVideo(item, editScript)}>
                    {isRegenerating
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating...</>
                      : <><RotateCcw className="h-3.5 w-3.5" /> Generate Ulang Video</>
                    }
                  </Button>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground">CAPTION</Label>
                  <Textarea value={editCaption} onChange={e => setEditCaption(e.target.value)}
                    rows={3} className="resize-none text-sm" placeholder="Edit caption atau generate ulang..." />
                  <Button size="sm" variant="outline" className="w-full gap-1.5"
                    disabled={isCaptioning}
                    onClick={() => onRegenCaption(item, editScript || item.script)}>
                    {isCaptioning
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Membuat Caption...</>
                      : <><Sparkles className="h-3.5 w-3.5" /> Generate Ulang Caption</>
                    }
                  </Button>
                </div>
                <div className="mt-auto">
                  <Button size="sm" className="w-full gap-1.5" onClick={handleSave}>
                    <Save className="h-3.5 w-3.5" /> Simpan Perubahan
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function VideoAIPage() {
  const { t } = useLanguage()
  const { user, isBalanceLoaded } = useAuth()

  const [model, setModel] = useState<VideoModel>("text-to-video")
  const [title, setTitle] = useState("")
  const [script, setScript] = useState("")
  const [resolution, setResolution] = useState<Resolution>("480p")
  const [ratio, setRatio] = useState("16-9")
  const [duration, setDuration] = useState("30")
  const [sourceImage, setSourceImage] = useState<string | null>(null)
  const [sourceImageMimeType, setSourceImageMimeType] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)

  // Initialize from user.coins immediately to prevent 0-flash before API resolves
  const [coinBalance, setCoinBalance] = useState<number>(user?.coins ?? 0)
  const [history, setHistory] = useState<VideoItem[]>([])
  
  const [activeResultId, setActiveResultId] = useState<string | null>(null)
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")
  const activeItem = activeResultId ? history.find(h => h.id === activeResultId) || null : null

  const [detailItem, setDetailItem] = useState<VideoItem | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [isModalRegenerating, setIsModalRegenerating] = useState(false)
  const [isModalCaptioning, setIsModalCaptioning] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  // Simpan interval refs agar bisa di-clear
  const pollingRefs = useRef<Record<string, ReturnType<typeof setInterval>>>({})

  // Clear temporary state on page unmount
  useEffect(() => {
    return () => {
      setActiveResultId(null)
      setTitle("")
      setScript("")
      setDuration("30")
      setSourceImage(null)
      setSourceImageMimeType(null)
      // Stop all running intervals on unmount
      Object.values(pollingRefs.current).forEach(clearInterval)
      pollingRefs.current = {}
    }
  }, [])

  // NOTE: Do NOT clear activeResultId when script/title changes.
  // Doing so would wipe the result preview when the form auto-resets after generation.

  const connectedSocmed: ConnectedSocmed[] = ["twitter", "instagram"]
  const coinCost = resolutionCost[resolution]
  const selectedRatio = RATIO_OPTIONS.find(r => r.value === ratio)!
  // Only consider balance insufficient AFTER it has been confirmed loaded to avoid flash
  const canGenerate = script.trim() && title.trim() && duration && (!isBalanceLoaded || coinBalance >= coinCost) && !!user

  const reportAiUsage = async (payload: {
    apiName: string
    action: string
    model: string
    prompt: string
    promptTokens?: number | null
    completionTokens?: number | null
    totalTokens?: number | null
    quotaRemaining?: number | null
    metadata?: Record<string, any>
  }) => {
    try {
      const token = localStorage.getItem("carubra-token")
      if (!token) return
      await fetch("/api/ai-usage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })
    } catch {
      // Ignore logging failures
    }
  }

  const updateCoinBalance = (coins: number) => {
    setCoinBalance(coins)
    window.dispatchEvent(new CustomEvent("carubra-balance-updated", { detail: { coins } }))
  }

  // ─── Load history from backend ─────────────────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem("carubra-token")
    if (!token) return

    // Sync coin balance whenever auth context updates it (handles API fetch completion)
    if (typeof user?.coins === 'number') {
      setCoinBalance(user.coins)
    } else {
      const token = localStorage.getItem('carubra-token')
      if (token) {
        fetch('/api/users/balance', { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.json())
          .then(data => setCoinBalance(data.coins ?? 0))
          .catch(() => {})
      }
    }

    fetch("/api/video-ai", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        console.log('[video-ai] Frontend - received from history API:', data)
        const items: VideoItem[] = (data.videos || []).map((v: any) => {
          const videoUrl = v.video_url || v.videoUrl || null
          const mapped = {
            id: v.id,
            jobId: v.job_id || v.jobId,
            title: v.prompt?.slice(0, 40) || "Video",
            script: v.prompt || "",
            resolution: (v.resolution || "480p") as Resolution,
            ratio: v.aspect_ratio || v.style || "16-9",
            model: (v.model || "text-to-video") as VideoModel,
            duration: v.duration || 30,
            coinCost: v.coins_used || 2,
            status: v.status === "completed" ? "completed" : v.status === "failed" ? "failed" : "generating",
            completedTime: null,
            caption: v.caption || "",
            createdAt: new Date(v.created_at || v.createdAt),
            videoUrl: videoUrl,
          }
          console.log(`[video-ai] Frontend - mapped video item ${mapped.id}:`, {
            videoUrl: mapped.videoUrl,
            videoUrl_type: typeof mapped.videoUrl,
            videoUrl_length: mapped.videoUrl?.length,
            hasVideoUrl: !!mapped.videoUrl,
            status: mapped.status,
            db_aspect_ratio: v.aspect_ratio,
            db_style: v.style,
            mapped_ratio: mapped.ratio,
            db_resolution: v.resolution,
            mapped_resolution: mapped.resolution,
          })
          return mapped
        })
        console.log('[video-ai] Frontend - setting history state with', items.length, 'items')
        setHistory(items)

        // Resume polling untuk video yang masih processing
        items.forEach(item => {
          if (item.status === "generating" && item.jobId) {
            startPolling(item.id, item.jobId, item.script, Date.now())
          }
        })
      })
      .catch(() => {})
  }, [])

  // Cleanup semua interval saat unmount
  useEffect(() => {
    return () => {
      Object.values(pollingRefs.current).forEach(clearInterval)
    }
  }, [])

  // ─── Polling helper ────────────────────────────────────────────────────────
  const startPolling = (tempId: string, jobId: string, videoScript: string, startTime: number) => {
    // Hentikan polling lama kalau ada
    if (pollingRefs.current[tempId]) {
      clearInterval(pollingRefs.current[tempId])
    }

    const token = localStorage.getItem("carubra-token")
    let attempts = 0
    const maxAttempts = 120 // 120 × 10s = 20 menit max

    const interval = setInterval(async () => {
      attempts++
      if (attempts > maxAttempts) {
        clearInterval(pollingRefs.current[tempId])
        delete pollingRefs.current[tempId]
        const completedTime = Math.round((Date.now() - startTime) / 1000)
        setHistory(prev => prev.map(item =>
          item.id === tempId ? { ...item, status: "failed", completedTime } : item
        ))
        setCoinBalance(prev => prev + coinCost)
        return
      }

      try {
        const res = await fetch(`/api/video-ai/status/${encodeURIComponent(jobId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = await res.json()
        console.log(`[video-ai] Poll ${attempts}/${maxAttempts}: status=${data.status}`)

        if (data.status === "completed") {
          clearInterval(pollingRefs.current[tempId])
          delete pollingRefs.current[tempId]
          const completedTime = Math.round((Date.now() - startTime) / 1000)
          const videoUrl: string | undefined = data.videoUrl

          setHistory(prev => prev.map(item =>
            item.id === tempId ? { ...item, status: "completed", completedTime, videoUrl } : item
          ))
          // Make sure the preview panel shows this completed video
          setActiveResultId(tempId)
          setIsGenerating(false)

          // Generate caption
          await handleGenerateCaption(videoScript, tempId)

          // Reset form AFTER updating activeResultId so the preview doesn't vanish
          setTitle(""); setScript(""); setDuration("30")

        } else if (data.status === "failed") {
          clearInterval(pollingRefs.current[tempId])
          delete pollingRefs.current[tempId]
          const completedTime = Math.round((Date.now() - startTime) / 1000)
          setHistory(prev => prev.map(item =>
            item.id === tempId ? { ...item, status: "failed", completedTime } : item
          ))
          setIsGenerating(false)
          setCoinBalance(prev => prev + coinCost)
        }
        // kalau masih "processing" → lanjut polling
      } catch (err) {
        console.error("[video-ai] Poll error:", err)
      }
    }, 10000) // tiap 10 detik

    pollingRefs.current[tempId] = interval
  }

  // ─── Generate caption via backend ──────────────────────────────────────────
  const handleGenerateCaption = async (script: string, videoId: string) => {
    try {
      const token = localStorage.getItem("carubra-token")
      const response = await fetch("/api/video-ai/caption", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ script, videoId }),
      })
      const data = await response.json()
      const caption = data?.caption ?? ""
      const usage = data?.usage ?? null
      setHistory(prev => prev.map(item =>
        item.id === videoId ? { ...item, caption } : item
      ))
      await reportAiUsage({
        apiName: 'video-ai.caption',
        action: 'caption',
        model: 'video-caption',
        prompt: script,
        totalTokens: usage?.total_tokens ?? null,
        promptTokens: usage?.prompt_tokens ?? null,
        completionTokens: usage?.completion_tokens ?? null,
        metadata: { videoId },
      })
      return caption
    } catch {
      return ""
    }
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const mimeType = file.type || "image/jpeg"
    setSourceImageMimeType(mimeType)
    const reader = new FileReader()
    reader.onload = ev => {
      const result = ev.target?.result as string
      // Compress image before setting to state to avoid ECONNRESET (Payload Too Large)
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement("canvas")
        const MAX_DIM = 1280
        let width = img.width
        let height = img.height

        if (width > height && width > MAX_DIM) {
          height *= MAX_DIM / width
          width = MAX_DIM
        } else if (height > MAX_DIM) {
          width *= MAX_DIM / height
          height = MAX_DIM
        }

        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext("2d")
        ctx?.drawImage(img, 0, 0, width, height)
        const compressedBase64 = canvas.toDataURL("image/jpeg", 0.8)
        setSourceImage(compressedBase64)
      }
      img.src = result
    }
    reader.readAsDataURL(file)
  }

  // ─── Generate video ────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!canGenerate) return
    setIsGenerating(true)
    const startTime = Date.now()
    const tempId = Date.now().toString()
    setActiveResultId(tempId)

    setHistory(prev => [{
      id: tempId, title, script, resolution, ratio, model,
      duration: parseInt(duration), coinCost, status: "generating",
      completedTime: null, caption: "", createdAt: new Date(),
    }, ...prev])
    setCoinBalance(prev => prev - coinCost)

    try {
      const token = localStorage.getItem("carubra-token")
      if (!token) throw new Error("Auth required")

      const body: Record<string, unknown> = {
        prompt: script,
        style: ratio,
        duration: parseInt(duration),
        resolution,
      }
      if (model === "image-to-video" && sourceImage) {
        body.init_image = sourceImage.split(",")[1]
        body.mime_type = sourceImageMimeType || "image/jpeg"
      }

      let response: Response
      try {
        response = await fetch("/api/video-ai/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        })
      } catch (fetchError: any) {
        console.error("[video-ai] Network error:", fetchError)
        const completedTime = Math.round((Date.now() - startTime) / 1000)
        setHistory(prev => prev.map(item =>
          item.id === tempId ? { ...item, status: "failed", completedTime } : item
        ))
        setCoinBalance(prev => prev + coinCost)
        setIsGenerating(false)
        setErrorMessage(`Network error: ${fetchError.message || 'Could not connect to server'}`)
        setShowErrorModal(true)
        return
      }

      if (!response.ok) {
        const errorText = await response.text()
        console.error("[video-ai] Response status:", response.status)
        console.error("[video-ai] Response text:", errorText)
        let errData: any = {}
        try {
          errData = JSON.parse(errorText)
        } catch {}
        console.error("[video-ai] Parsed error data:", errData)
        const completedTime = Math.round((Date.now() - startTime) / 1000)
        setHistory(prev => prev.map(item =>
          item.id === tempId ? { ...item, status: "failed", completedTime } : item
        ))
        setCoinBalance(prev => prev + coinCost)
        setIsGenerating(false)
        setErrorMessage(`Video generation failed: ${errData.error || errorText || 'Unknown error'}`)
        setShowErrorModal(true)
        return
      }

      // Backend return 202 dengan jobId — mulai polling di frontend
      const data = await response.json()
      const videoId: string  = data?.video?.id    ?? tempId
      const jobId:   string  = data?.video?.jobId ?? ""
      if (typeof data?.coins === "number") updateCoinBalance(data.coins)

      await reportAiUsage({
        apiName: 'video-ai.generate',
        action: 'generate',
        model: model,
        prompt: script,
        totalTokens: null,
        promptTokens: null,
        completionTokens: null,
        metadata: { style: ratio, duration: parseInt(duration) },
      })

      // Update tempId → real videoId di history, and keep activeResultId in sync
      setHistory(prev => prev.map(item =>
        item.id === tempId ? { ...item, id: videoId, jobId } : item
      ))
      // Sync activeResultId to the real DB ID so the preview keeps tracking this item
      setActiveResultId(videoId)

      if (!jobId) {
        throw new Error("No jobId returned")
      }

      // Mulai polling — isGenerating tetap true sampai polling selesai
      startPolling(videoId, jobId, script, startTime)

    } catch (err) {
      console.error("[video-ai] Error:", err)
      const completedTime = Math.round((Date.now() - startTime) / 1000)
      setHistory(prev => prev.map(item =>
        item.id === tempId ? { ...item, status: "failed", completedTime } : item
      ))
      setCoinBalance(prev => prev + coinCost)
      setIsGenerating(false)
    }
  }

  const handleDelete = async (id: string) => {
    // Stop polling if still running
    if (pollingRefs.current[id]) {
      clearInterval(pollingRefs.current[id])
      delete pollingRefs.current[id]
    }

    // Temp IDs are numeric timestamps (Date.now().toString()); real DB IDs are UUIDs.
    // Deleting a temp ID silently fails in the API and reappears on next refresh.
    const isRealId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    if (!isRealId) {
      setHistory(prev => prev.filter(item => item.id !== id))
      return
    }

    try {
      const token = localStorage.getItem("carubra-token")
      const res = await fetch(`/api/video-ai/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        console.error("Failed to delete video:", err)
        // Still remove from UI to avoid stuck item
      }
      setHistory(prev => prev.filter(item => item.id !== id))
    } catch (error) {
      console.error("Failed to delete video:", error)
      // Remove from UI anyway so user isn't stuck
      setHistory(prev => prev.filter(item => item.id !== id))
    }
  }


  const handleSaveEdit = (id: string, newTitle: string, newScript: string, newCaption: string) => {
    setHistory(prev => prev.map(item =>
      item.id === id ? { ...item, title: newTitle, script: newScript, caption: newCaption } : item
    ))
    setDetailItem(prev => prev && prev.id === id
      ? { ...prev, title: newTitle, script: newScript, caption: newCaption }
      : prev
    )
  }

  const handleModalRegenCaption = async (item: VideoItem, newScript: string) => {
    setIsModalCaptioning(true)
    try {
      const caption = await handleGenerateCaption(newScript, item.id)
      setDetailItem(prev => prev ? { ...prev, caption } : prev)
    } finally {
      setIsModalCaptioning(false)
    }
  }

  const handleModalRegenVideo = async (item: VideoItem, newScript: string) => {
    if (coinBalance < coinCost) return
    setIsModalRegenerating(true)
    setCoinBalance(prev => prev - coinCost)
    try {
      const token = localStorage.getItem("carubra-token")
      const response = await fetch("/api/video-ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ prompt: newScript, style: item.ratio, duration: item.duration, resolution: item.resolution }),
      })
      if (!response.ok) throw new Error("Failed")
      const data = await response.json()
      const videoId: string = data?.video?.id    ?? item.id
      const jobId:   string = data?.video?.jobId ?? ""
      if (typeof data?.coins === "number") updateCoinBalance(data.coins)

      await reportAiUsage({
        apiName: 'video-ai.generate',
        action: 'regen-generate',
        model: item.model,
        prompt: newScript,
        totalTokens: null,
        promptTokens: null,
        completionTokens: null,
        metadata: { videoId: item.id, style: item.ratio, duration: item.duration },
      })

      const updated: VideoItem = { ...item, id: videoId, jobId, script: newScript, status: "generating" }
      setHistory(prev => prev.map(h => h.id === item.id ? updated : h))
      setDetailItem(updated)

      if (jobId) {
        startPolling(videoId, jobId, newScript, Date.now())
      }
    } catch {
      setCoinBalance(prev => prev + coinCost)
    } finally {
      setIsModalRegenerating(false)
    }
  }

  const openDetail = (item: VideoItem) => {
    console.log('[video-ai] Frontend - openDetail called with item:', {
      id: item.id,
      videoUrl: item.videoUrl,
      videoUrl_type: typeof item.videoUrl,
      videoUrl_length: item.videoUrl?.length,
      hasVideoUrl: !!item.videoUrl,
      status: item.status,
    })
    console.log('[video-ai] Frontend - setting detailItem state with full item:', item)
    // Create a deep copy to prevent reference corruption
    const itemCopy = { ...item }
    console.log('[video-ai] Frontend - itemCopy videoUrl:', itemCopy.videoUrl)
    setDetailItem(itemCopy)
    setDetailOpen(true)
    // Fallback: if completed video has no caption, auto-generate one
    if (item.status === "completed" && !item.caption) {
      handleGenerateCaption(item.script, item.id)
    }
  }

  const formatTime = (seconds: number | null) => {
    if (seconds === null) return "—"
    if (seconds < 60) return `${seconds} detik`
    return `${Math.floor(seconds / 60)} menit`
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <Video className="h-8 w-8 text-primary" />
            Video AI
          </h1>
          <p className="text-muted-foreground mt-1">Buat video dengan AI dari deskripsi teks</p>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid xl:grid-cols-5 gap-6">
        {/* Left Panel */}
        <div className="xl:col-span-2 space-y-4">
          <Card className="border-2">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Zap className="h-5 w-5 text-primary" />
                Generate Video
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Model */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Model</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(["text-to-video", "image-to-video"] as VideoModel[]).map(m => (
                    <button key={m} onClick={() => setModel(m)}
                      className={cn("rounded-lg border-2 px-3 py-2.5 text-sm font-medium transition-all",
                        model === m ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:border-primary/50"
                      )}>
                      {m === "text-to-video" ? "Text to Video" : "Image to Video"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Image Upload */}
              {model === "image-to-video" && (
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Gambar Sumber</Label>
                  <div onClick={() => fileInputRef.current?.click()}
                    className={cn("border-2 border-dashed rounded-xl cursor-pointer transition-colors flex flex-col items-center justify-center gap-2 p-4 min-h-[120px]",
                      sourceImage ? "border-primary/50" : "border-border hover:border-primary/50"
                    )}>
                    {sourceImage
                      ? <img src={sourceImage} alt="source" className="max-h-32 rounded-lg object-contain" />
                      : <><Upload className="h-8 w-8 text-muted-foreground" /><span className="text-sm text-muted-foreground">Klik untuk upload gambar</span></>
                    }
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                </div>
              )}

              {/* Ratio Picker */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Rasio Video</Label>
                <div className="grid grid-cols-5 gap-1.5">
                  {RATIO_OPTIONS.map(r => (
                    <button key={r.value} onClick={() => setRatio(r.value)} title={`${r.label} (${r.ratio})`}
                      className={cn("rounded-lg border-2 p-1.5 flex flex-col items-center gap-1 transition-all text-[10px]",
                        ratio === r.value ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"
                      )}>
                      <div className="flex items-center justify-center w-full" style={{ height: 28 }}>
                        <div className={cn("rounded-sm border-2", ratio === r.value ? "border-primary bg-primary/20" : "border-muted-foreground/40 bg-muted")}
                          style={{ width: Math.min(22, 22 * (r.w / Math.max(r.w, r.h))), height: Math.min(22, 22 * (r.h / Math.max(r.w, r.h))) }} />
                      </div>
                      <span className={cn("font-medium leading-tight text-center", ratio === r.value ? "text-primary" : "text-muted-foreground")}>{r.ratio}</span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{selectedRatio.label} — {selectedRatio.ratio}</p>
              </div>

              {/* Resolution */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Resolusi</Label>
                <div className="grid grid-cols-4 gap-2">
                  {(["480p", "720p", "1080p", "2K"] as Resolution[]).map(r => (
                    <button key={r} onClick={() => setResolution(r)}
                      className={cn("rounded-lg border-2 px-1 py-2 text-sm font-medium transition-all flex flex-col items-center",
                        resolution === r ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:border-primary/50"
                      )}>
                      <span>{r}</span>
                      <span className="text-[10px] font-normal opacity-70">{resolutionCost[r]} koin</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Title */}
              <div className="space-y-2">
                <Label htmlFor="title" className="text-sm font-semibold">Judul Video</Label>
                <Input id="title" placeholder="Masukkan judul video..." value={title} onChange={e => setTitle(e.target.value)} className="text-sm" />
              </div>

              {/* Duration */}
              <div className="space-y-2">
                <Label htmlFor="duration" className="text-sm font-semibold">Durasi (detik)</Label>
                <Input id="duration" type="number" min="1" max="60" value={duration}
                  onChange={e => setDuration(e.target.value)} placeholder="30" className="text-sm" />
                <p className="text-xs text-muted-foreground">Maksimal 60 detik</p>
              </div>

              {/* Script */}
              <div className="space-y-2">
                <Label htmlFor="script" className="text-sm font-semibold">Script / Deskripsi</Label>
                <Textarea id="script"
                  placeholder="Deskripsikan video yang ingin kamu buat..."
                  value={script} onChange={e => setScript(e.target.value)} rows={5} className="resize-none text-sm" />
              </div>

              {/* Cost */}
              <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Info className="h-4 w-4" /><span>Biaya generate</span>
                </div>
                <div className="flex items-center gap-1 font-semibold text-sm">
                  <Coins className="h-4 w-4 text-amber-500" />
                  <span className="text-amber-600">{coinCost} koin</span>
                </div>
              </div>

              {/* Only show insufficient balance warning AFTER balance has fully loaded to prevent flash */}
              {isBalanceLoaded && coinBalance < coinCost && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive flex items-center gap-2">
                  <XCircle className="h-4 w-4 flex-shrink-0" />Saldo koin tidak cukup.
                </div>
              )}

              <Button onClick={handleGenerate} disabled={isGenerating || !canGenerate} className="w-full h-12 text-base font-semibold" size="lg">
                {isGenerating
                  ? <><Loader2 className="h-5 w-5 mr-2 animate-spin" />Sedang Generate...</>
                  : <><Sparkles className="h-5 w-5 mr-2" />Generate Video</>
                }
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Right Panel */}
        <div className="xl:col-span-3 space-y-4">
          <Card className="border-2">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Video className="h-5 w-5 text-primary" />
                Hasil Generate
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className={cn("w-full rounded-xl border-2 border-dashed overflow-hidden bg-muted/30 flex items-center justify-center",
                selectedRatio.tw, "min-h-[200px] max-h-[500px]")}>
                {activeItem?.status === "generating" ? (
                  <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                    <p className="text-sm font-medium">Membuat video...</p>
                    <p className="text-xs opacity-60">Ini mungkin memerlukan beberapa menit</p>
                  </div>
                ) : activeItem?.status === "completed" && activeItem?.videoUrl ? (
                  <video src={activeItem.videoUrl} controls className="w-full h-full rounded-xl object-contain"
                    onLoadStart={(e) => console.log('[VIDEO-DEBUG] active-loadstart', { src: e.currentTarget.currentSrc, network: e.currentTarget.networkState, ready: e.currentTarget.readyState })}
                    onLoadedMetadata={(e) => console.log('[VIDEO-DEBUG] active-loadedmetadata', { src: e.currentTarget.currentSrc, vw: e.currentTarget.videoWidth, vh: e.currentTarget.videoHeight, dur: e.currentTarget.duration, network: e.currentTarget.networkState, ready: e.currentTarget.readyState })}
                    onLoadedData={(e) => console.log('[VIDEO-DEBUG] active-loadeddata', { src: e.currentTarget.currentSrc, vw: e.currentTarget.videoWidth, vh: e.currentTarget.videoHeight, network: e.currentTarget.networkState, ready: e.currentTarget.readyState })}
                    onCanPlay={(e) => console.log('[VIDEO-DEBUG] active-canplay', { src: e.currentTarget.currentSrc, vw: e.currentTarget.videoWidth, vh: e.currentTarget.videoHeight, network: e.currentTarget.networkState, ready: e.currentTarget.readyState })}
                    onCanPlayThrough={(e) => console.log('[VIDEO-DEBUG] active-canplaythrough', { src: e.currentTarget.currentSrc })}
                    onPlaying={(e) => console.log('[VIDEO-DEBUG] active-playing', { src: e.currentTarget.currentSrc, time: e.currentTarget.currentTime })}
                    onError={(e) => console.log('[VIDEO-DEBUG] active-error', { src: e.currentTarget.currentSrc, code: e.currentTarget.error?.code, message: (e.currentTarget.error as any)?.message, network: e.currentTarget.networkState, ready: e.currentTarget.readyState })}
                  />
                ) : activeItem?.status === "failed" ? (
                  <div className="flex flex-col items-center gap-3 text-muted-foreground p-8 text-center">
                    <XCircle className="h-12 w-12 opacity-40 text-destructive" />
                    <p className="text-sm font-medium text-destructive">Generate video gagal</p>
                    <p className="text-xs opacity-60">Coba lagi dengan prompt berbeda</p>
                  </div>
                ) : activeItem?.status === "completed" ? (
                  <div className="flex flex-col items-center gap-3 text-muted-foreground p-8 text-center">
                    <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                      <Video className="h-8 w-8 text-primary" />
                    </div>
                    <p className="text-sm font-medium">Video berhasil dibuat</p>
                    <p className="text-xs opacity-60">Preview tidak tersedia</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 text-muted-foreground p-8 text-center">
                    <Video className="h-12 w-12 opacity-30" />
                    <p className="text-sm">Hasil video akan tampil di sini</p>
                  </div>
                )}
              </div>

              {activeItem?.status !== "generating" && activeItem?.status === "completed" && (
                <>
                  <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
                    <p className="text-sm font-semibold">{activeItem.title}</p>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>{activeItem.resolution}</span><span>·</span>
                      <span>{activeItem.duration}s</span><span>·</span>
                      <span>{activeItem.coinCost} koin</span><span>·</span>
                      <Clock className="h-3 w-3 self-center" />
                      <span>Selesai dalam {formatTime(activeItem.completedTime)}</span>
                    </div>
                    {activeItem.caption && (
                      <p className="text-xs italic text-muted-foreground border-t pt-2">"{activeItem.caption}"</p>
                    )}
                  </div>
                  {connectedSocmed.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold flex items-center gap-2">
                        <Share2 className="h-4 w-4" /> Bagikan ke Sosial Media
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {connectedSocmed.includes("twitter") && (
                          <Button size="sm" className="gap-2 bg-sky-500 hover:bg-sky-600 text-white border-0">
                            <TwitterIcon className="h-4 w-4" /> Twitter / X
                          </Button>
                        )}
                        {connectedSocmed.includes("instagram") && (
                          <Button size="sm" className="gap-2 bg-gradient-to-r from-pink-500 to-purple-600 text-white border-0">
                            <InstagramIcon className="h-4 w-4" /> Instagram
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* History & Gallery */}
      <Card className="border-2">
        <CardContent className="pt-4">
          <Tabs defaultValue="history">
            <TabsList className="mb-4">
              <TabsTrigger value="history" className="gap-2"><History className="h-4 w-4" /> History Generate</TabsTrigger>
              <TabsTrigger value="gallery" className="gap-2"><LayoutGrid className="h-4 w-4" /> Galeri Video</TabsTrigger>
            </TabsList>

            <TabsContent value="history">
              {history.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <History className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Belum ada riwayat generate video</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {history.map(item => (
                    <div key={item.id}
                      className="p-4 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors space-y-3 cursor-pointer group"
                      onClick={() => openDetail(item)}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-1">
                          <p className="font-medium text-foreground">{item.title}</p>
                          <p className="text-sm text-muted-foreground line-clamp-2">{item.script}</p>
                        </div>
                        <Badge
                          variant={item.status === "completed" ? "default" : item.status === "failed" ? "destructive" : "secondary"}
                          className="gap-1 flex-shrink-0"
                        >
                          {item.status === "completed" && <CheckCircle2 className="h-3 w-3" />}
                          {item.status === "failed" && <XCircle className="h-3 w-3" />}
                          {item.status === "generating" && <Loader2 className="h-3 w-3 animate-spin" />}
                          {item.status === "completed" ? "Selesai" : item.status === "failed" ? "Gagal" : "Proses..."}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatTime(item.completedTime)}</span>
                        <span>Durasi: {item.duration} detik</span>
                        <span>{item.resolution} · {RATIO_OPTIONS.find(r => r.value === item.ratio)?.ratio ?? item.ratio}</span>
                        <span>{item.coinCost} koin</span>
                        <span>{item.createdAt.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      {item.caption && (
                        <p className="text-xs italic text-muted-foreground line-clamp-1">Caption: {item.caption}</p>
                      )}
                      <div className="flex gap-2 pt-1" onClick={e => e.stopPropagation()}>
                        <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => openDetail(item)}>
                          <Eye className="h-3 w-3" /> Lihat Detail
                        </Button>
                        <Button size="sm" variant="outline" className="flex-1 gap-1"
                          onClick={() => { setDetailItem(item); setDetailOpen(true) }}>
                          <Edit2 className="h-3 w-3" /> Edit
                        </Button>
                        <Button size="sm" variant="outline" className="flex-1 gap-1"
                          disabled={item.status !== "completed" || connectedSocmed.length === 0}
                          onClick={() => openDetail(item)}>
                          <Send className="h-3 w-3" /> Post
                        </Button>
                        <Button size="sm" variant="outline" className="px-3 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleDelete(item.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="gallery">
              {history.filter(h => h.status === "completed").length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <LayoutGrid className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Belum ada video di galeri</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {history.filter(h => h.status === "completed").map(item => (
                    <div key={item.id}
                      className="rounded-xl border overflow-hidden bg-muted/30 hover:shadow-lg transition-shadow cursor-pointer group"
                      onClick={() => openDetail(item)}
                    >
                      <div className="aspect-video bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center relative">
                        {item.videoUrl
                          ? <video src={item.videoUrl} className="w-full h-full object-cover"
                              onLoadStart={(e) => console.log('[VIDEO-DEBUG] gallery-loadstart', { src: e.currentTarget.currentSrc, network: e.currentTarget.networkState, ready: e.currentTarget.readyState })}
                              onLoadedMetadata={(e) => console.log('[VIDEO-DEBUG] gallery-loadedmetadata', { src: e.currentTarget.currentSrc, vw: e.currentTarget.videoWidth, vh: e.currentTarget.videoHeight, dur: e.currentTarget.duration, network: e.currentTarget.networkState, ready: e.currentTarget.readyState })}
                              onLoadedData={(e) => console.log('[VIDEO-DEBUG] gallery-loadeddata', { src: e.currentTarget.currentSrc, vw: e.currentTarget.videoWidth, vh: e.currentTarget.videoHeight, network: e.currentTarget.networkState, ready: e.currentTarget.readyState })}
                              onCanPlay={(e) => console.log('[VIDEO-DEBUG] gallery-canplay', { src: e.currentTarget.currentSrc, vw: e.currentTarget.videoWidth, vh: e.currentTarget.videoHeight, network: e.currentTarget.networkState, ready: e.currentTarget.readyState })}
                              onCanPlayThrough={(e) => console.log('[VIDEO-DEBUG] gallery-canplaythrough', { src: e.currentTarget.currentSrc })}
                              onPlaying={(e) => console.log('[VIDEO-DEBUG] gallery-playing', { src: e.currentTarget.currentSrc, time: e.currentTarget.currentTime })}
                              onError={(e) => console.log('[VIDEO-DEBUG] gallery-error', { src: e.currentTarget.currentSrc, code: e.currentTarget.error?.code, message: (e.currentTarget.error as any)?.message, network: e.currentTarget.networkState, ready: e.currentTarget.readyState })}
                            />
                          : <Video className="h-12 w-12 text-muted-foreground opacity-40" />
                        }
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <Eye className="h-8 w-8 text-white" />
                        </div>
                      </div>
                      <div className="p-3 space-y-2">
                        <p className="font-medium text-sm line-clamp-1">{item.title}</p>
                        <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                          <span>{item.resolution}</span><span>·</span>
                          <span>{item.duration}s</span><span>·</span>
                          <span>{item.coinCost} koin</span>
                        </div>
                        {item.caption && (
                          <p className="text-xs text-muted-foreground italic line-clamp-2">"{item.caption}"</p>
                        )}
                        <div className="flex gap-2 pt-1" onClick={e => e.stopPropagation()}>
                          <Button size="sm" variant="outline" className="flex-1 gap-1.5" onClick={() => openDetail(item)}>
                            <Share2 className="h-3 w-3" /> Bagikan
                          </Button>
                          <Button size="sm" variant="outline" className="px-2 text-destructive hover:text-destructive" onClick={() => handleDelete(item.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Detail Modal */}
      <DetailModal
        item={detailItem}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onDelete={handleDelete}
        onSave={handleSaveEdit}
        onRegenCaption={handleModalRegenCaption}
        onRegenVideo={handleModalRegenVideo}
        connectedSocmed={connectedSocmed}
        isRegenerating={isModalRegenerating}
        isCaptioning={isModalCaptioning}
      />

      {/* Error Modal */}
      <Dialog open={showErrorModal} onOpenChange={setShowErrorModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 rounded-full">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <DialogTitle>Error</DialogTitle>
            </div>
            <DialogDescription className="pt-2">
              {errorMessage}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setShowErrorModal(false)}>
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
