"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Loader2, Video, Sparkles, Send, Coins, CheckCircle2, XCircle, Clock,
  RotateCcw, Save, X, Eye, ChevronLeft, ChevronRight, AlertTriangle,
} from "lucide-react"
import { useLanguage } from "@/contexts/language-context"
import { useAuth } from "@/contexts/auth-context"
import { cn } from "@/lib/utils"

type SessionStatus = "editing" | "completed" | "cancelled" | "expired"
type VersionStatus = "draft" | "completed" | "failed"

type VideoSession = {
  id: string
  user_id: string
  original_prompt: string
  current_prompt: string
  draft_video_path: string | null
  current_version: number
  coins_used: number
  status: SessionStatus
  resolution: string
  aspect_ratio: string
  duration: number
  model: string
  source_image_url: string | null
  created_at: string
  updated_at: string
  expires_at: string
}

type SessionVersion = {
  id: string
  session_id: string
  version_number: number
  prompt: string
  draft_video_path: string | null
  video_url: string | null
  job_id: string | null
  status: VersionStatus
  created_at: string
}

type VideoSessionEditorProps = {
  sessionId: string | null
  onClose: () => void
  onSessionCreated?: (sessionId: string) => void
}

const POLL_MAX_ATTEMPTS = 30
const POLL_INTERVAL = 5000

export function VideoSessionEditor({ sessionId, onClose, onSessionCreated }: VideoSessionEditorProps) {
  const { t } = useLanguage()
  const { user } = useAuth()

  const [session, setSession] = useState<VideoSession | null>(null)
  const [versions, setVersions] = useState<SessionVersion[]>([])
  const [editPrompt, setEditPrompt] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [currentVideoUrl, setCurrentVideoUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [pollInterval, setPollInterval] = useState<NodeJS.Timeout | null>(null)
  const [pollTimeout, setPollTimeout] = useState(false)
  const [isExpiredPreview, setIsExpiredPreview] = useState(false)

  const cleanupPolling = () => {
    if (pollInterval) {
      clearInterval(pollInterval)
      setPollInterval(null)
    }
  }

  // Load session data
  useEffect(() => {
    if (sessionId) {
      loadSession(sessionId)
    }
    return () => {
      cleanupPolling()
    }
  }, [sessionId])

  const loadSession = async (id: string) => {
    try {
      const token = localStorage.getItem("carubra-token")
      const res = await fetch(`/api/video-sessions/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (res.ok) {
        setSession(data.session)
        setVersions(data.versions)
        setEditPrompt(data.session.current_prompt)
        setSelectedVersion(data.session.current_version)
        setPollTimeout(false)
        setIsExpiredPreview(false)

        if (data.session.draft_video_path) {
          setCurrentVideoUrl(`/api/temp-video/${data.session.draft_video_path.split('/').pop()}`)
        } else {
          startPolling(id)
        }
      }
    } catch (err) {
      console.error("Failed to load session:", err)
      setError("Failed to load session")
    }
  }

  const startPolling = (sid: string) => {
    cleanupPolling()

    let attempts = 0

    const interval = setInterval(async () => {
      attempts++

      if (attempts > POLL_MAX_ATTEMPTS) {
        cleanupPolling()
        setIsGenerating(false)
        setPollTimeout(true)
        setError("Generation timed out. The video took too long to generate.")
        return
      }

      try {
        const token = localStorage.getItem("carubra-token")
        const res = await fetch(`/api/video-sessions/${sid}/poll`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = await res.json()

        if (data.status === 'completed') {
          cleanupPolling()
          setIsGenerating(false)
          setPollTimeout(false)
          setError(null)

          setSession(data.session)
          setCurrentVideoUrl(`/api/temp-video/${data.draft_video_path.split('/').pop()}`)

          await loadSession(sid)
        } else if (data.status === 'failed') {
          cleanupPolling()
          setIsGenerating(false)
          setPollTimeout(false)
          setError(data.error || 'Video generation failed')
        }
      } catch (err) {
        console.error('[VideoSessionEditor] Polling error:', err)
      }
    }, POLL_INTERVAL)

    setPollInterval(interval)
  }

  const handleGenerateEdit = async () => {
    if (!session || !editPrompt.trim()) return

    setIsGenerating(true)
    setError(null)
    setPollTimeout(false)
    setIsExpiredPreview(false)
    setCurrentVideoUrl(null)

    try {
      const token = localStorage.getItem("carubra-token")

      const res = await fetch(`/api/video-sessions/${session.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "edit",
          prompt: editPrompt,
        }),
      })

      const data = await res.json()
      if (res.ok) {
        setSession(data.session)
        setEditPrompt(data.session.current_prompt)
        setSelectedVersion(data.session.current_version)
        startPolling(session.id)
      } else {
        setError(data.error || "Failed to generate edit")
        setIsGenerating(false)
      }
    } catch (err) {
      console.error("Failed to generate edit:", err)
      setError("Failed to generate edit")
      setIsGenerating(false)
    }
  }

  const handleRegenerate = async () => {
    if (!session) return

    setIsGenerating(true)
    setError(null)
    setPollTimeout(false)
    setIsExpiredPreview(false)
    setCurrentVideoUrl(null)

    try {
      const token = localStorage.getItem("carubra-token")

      const res = await fetch(`/api/video-sessions/${session.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "regenerate",
          prompt: session.current_prompt,
        }),
      })

      const data = await res.json()
      if (res.ok) {
        setSession(data.session)
        startPolling(session.id)
      } else {
        setError(data.error || "Failed to regenerate")
        setIsGenerating(false)
      }
    } catch (err) {
      console.error("Failed to regenerate:", err)
      setError("Failed to regenerate")
      setIsGenerating(false)
    }
  }

  const handleRetryGeneration = async () => {
    if (!session) return
    setPollTimeout(false)
    setIsExpiredPreview(false)
    setError(null)
    setCurrentVideoUrl(null)
    await handleRegenerate()
  }

  const handleSwitchVersion = async (versionNumber: number) => {
    if (!session) return

    try {
      const token = localStorage.getItem("carubra-token")

      const res = await fetch(`/api/video-sessions/${session.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "switch_version",
          version_number: versionNumber,
        }),
      })

      const data = await res.json()
      if (res.ok) {
        setSession(data.session)
        setSelectedVersion(versionNumber)
        setEditPrompt(data.session.current_prompt)
        setError(null)
        setIsExpiredPreview(false)

        const targetVersion = versions.find(v => v.version_number === versionNumber)
        if (targetVersion?.draft_video_path) {
          setCurrentVideoUrl(`/api/temp-video/${targetVersion.draft_video_path.split('/').pop()}`)
        } else {
          setCurrentVideoUrl(null)
        }
      } else {
        setError(data.error || "Failed to switch version")
      }
    } catch (err) {
      console.error("Failed to switch version:", err)
      setError("Failed to switch version")
    }
  }

  const handleComplete = async () => {
    if (!session) return

    setIsSaving(true)
    setError(null)

    try {
      const token = localStorage.getItem("carubra-token")

      const res = await fetch(`/api/video-sessions/${session.id}/complete`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })

      const data = await res.json()
      if (res.ok) {
        cleanupPolling()
        setSession({ ...session, status: "completed" as SessionStatus })
        onClose()
      } else {
        setError(data.error || "Failed to save final video")
      }
    } catch (err) {
      console.error("Failed to complete session:", err)
      setError("Failed to save final video")
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = async () => {
    if (!session) return

    setIsCancelling(true)
    setError(null)

    try {
      const token = localStorage.getItem("carubra-token")

      const res = await fetch(`/api/video-sessions/${session.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })

      if (res.ok) {
        cleanupPolling()
        onClose()
      } else {
        setError("Failed to cancel session")
      }
    } catch (err) {
      console.error("Failed to cancel session:", err)
      setError("Failed to cancel session")
    } finally {
      setIsCancelling(false)
    }
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const coinCost = session.resolution === "720p" ? 3 : 2

  return (
    <div className="space-y-6">
      {/* Error Message */}
      {error && !pollTimeout && !isGenerating && (
        <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Video Preview */}
      <Card>
        <CardContent className="p-0">
          <div className="bg-neutral-100 dark:bg-neutral-900/50 flex items-center justify-center p-6 min-h-[400px]">
            {(() => {
              if (isGenerating && !pollTimeout) {
                return (
                  <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                    <p className="text-sm font-medium">Generating video...</p>
                    <p className="text-xs opacity-60">This may take a few minutes</p>
                  </div>
                )
              }

              if (pollTimeout) {
                return (
                  <div className="flex flex-col items-center gap-3 text-center">
                    <XCircle className="h-12 w-12 text-destructive opacity-60" />
                    <div>
                      <p className="text-sm font-medium text-destructive">Generation failed or timed out.</p>
                      <p className="text-xs text-muted-foreground mt-1">The video generation did not complete in time.</p>
                    </div>
                    <div className="flex gap-2 mt-2">
                      <Button size="sm" onClick={handleRetryGeneration} variant="outline" className="gap-1.5">
                        <RotateCcw className="h-4 w-4" /> Retry Generation
                      </Button>
                      <Button size="sm" onClick={handleCancel} variant="outline" className="gap-1.5">
                        <X className="h-4 w-4" /> Cancel Session
                      </Button>
                    </div>
                  </div>
                )
              }

              if (isExpiredPreview) {
                return (
                  <div className="flex flex-col items-center gap-3 text-center">
                    <AlertTriangle className="h-12 w-12 text-amber-500 opacity-60" />
                    <div>
                      <p className="text-sm font-medium">This temporary preview has expired.</p>
                      <p className="text-xs text-muted-foreground mt-1">Temporary previews expire after 2 hours.</p>
                    </div>
                    <div className="flex gap-2 mt-2">
                      <Button size="sm" onClick={handleRetryGeneration} variant="outline" className="gap-1.5">
                        <RotateCcw className="h-4 w-4" /> Regenerate Preview
                      </Button>
                      <Button size="sm" onClick={handleCancel} variant="outline" className="gap-1.5">
                        <X className="h-4 w-4" /> Discard Session
                      </Button>
                    </div>
                  </div>
                )
              }

              if (error && !currentVideoUrl) {
                return (
                  <div className="flex flex-col items-center gap-3 text-center">
                    <XCircle className="h-12 w-12 text-destructive opacity-40" />
                    <p className="text-sm font-medium text-destructive">{error}</p>
                  </div>
                )
              }

              if (currentVideoUrl) {
                return (
                  <video
                    src={currentVideoUrl}
                    controls
                    className="rounded-xl max-w-full max-h-[60vh] shadow-2xl"
                    preload="metadata"
                    onError={() => {
                      console.warn('[VideoSessionEditor] Video load error, temp file may be expired')
                      setCurrentVideoUrl(null)
                      setIsExpiredPreview(true)
                    }}
                  />
                )
              }

              return (
                <div className="flex flex-col items-center gap-3 text-muted-foreground">
                  <Video className="h-12 w-12 opacity-30" />
                  <p className="text-sm font-medium">No video generated yet</p>
                </div>
              )
            })()}
          </div>
        </CardContent>
      </Card>

      {/* Version Info */}
      <div className="flex items-center justify-between">
        <Badge variant="secondary" className="gap-1.5">
          Version {session.current_version}
          <Clock className="h-3 w-3" />
        </Badge>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Coins className="h-4 w-4" />
          {session.coins_used} coins used
        </div>
      </div>

      {/* Version History */}
      {versions.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Version History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {versions.map((version) => (
                <Button
                  key={version.id}
                  size="sm"
                  variant={selectedVersion === version.version_number ? "default" : "outline"}
                  onClick={() => handleSwitchVersion(version.version_number)}
                  disabled={isGenerating || isSaving}
                  className="flex-shrink-0"
                >
                  V{version.version_number}
                  {version.status === "completed" && <CheckCircle2 className="h-3 w-3 ml-1" />}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Edit Prompt */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Edit Prompt</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Current Prompt</Label>
            <p className="text-sm text-muted-foreground">{session.current_prompt}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-prompt">New Prompt</Label>
            <Textarea
              id="edit-prompt"
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              placeholder="Describe your edit (e.g., 'make him smile')"
              rows={3}
              disabled={isGenerating || isSaving}
            />
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleGenerateEdit}
              disabled={!editPrompt.trim() || isGenerating || isSaving}
              className="flex-1 gap-1.5"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate Edit
                </>
              )}
            </Button>
            <Button
              onClick={handleRegenerate}
              variant="outline"
              disabled={isGenerating || isSaving}
              className="gap-1.5"
            >
              <RotateCcw className="h-4 w-4" />
              Regenerate
            </Button>
          </div>
          <div className="text-xs text-muted-foreground text-center">
            Edit = {coinCost} Coins
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <Button
          onClick={handleComplete}
          disabled={!session.draft_video_path || isSaving || isGenerating || isCancelling}
          className="flex-1 gap-1.5"
          size="lg"
        >
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4" />
              Save Final Video
            </>
          )}
        </Button>
        <Button
          onClick={handleCancel}
          variant="outline"
          disabled={isSaving || isGenerating || isCancelling}
          className="gap-1.5"
          size="lg"
        >
          {isCancelling ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Cancelling...
            </>
          ) : (
            <>
              <X className="h-4 w-4" />
              Cancel
            </>
          )}
        </Button>
      </div>

      {/* Warning */}
      <div className="text-xs text-muted-foreground text-center">
        Coins are not refunded when cancelling. Session expires in 2 hours.
      </div>
    </div>
  )
}
