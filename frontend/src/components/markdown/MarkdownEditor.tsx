import Image from "@tiptap/extension-image"
import { Placeholder } from "@tiptap/extensions"
import { Markdown } from "@tiptap/markdown"
import { EditorContent, useEditor, type Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import {
  Bold,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Undo2,
} from "lucide-react"
import { useEffect, useRef, type ReactNode } from "react"
import { toast } from "sonner"
import type { UploadImageResponse } from "@shared/api"
import { apiUpload, errorMessage } from "@/api/client"
import { cn } from "@/lib/utils"

interface MarkdownEditorProps {
  initial: string
  onChange: (markdown: string) => void
  /** Programme to upload images to; without it, image upload is disabled. */
  programmeId?: string
  placeholder?: string
  autoFocus?: boolean
}

/** A WYSIWYG editor that reads and writes markdown, with image upload (paste, drop or button). */
export function MarkdownEditor({ initial, onChange, programmeId, placeholder, autoFocus }: MarkdownEditorProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  // Paste/drop handlers are created once with the editor; they reach the editor through this ref.
  const editorRef = useRef<Editor | null>(null)

  const upload = async (editor: Editor, file: File) => {
    if (!programmeId) return
    const form = new FormData()
    form.append("file", file)
    const id = toast.loading("Uploading image…")
    try {
      const { url } = await apiUpload<UploadImageResponse>(`/api/p/${programmeId}/images`, form)
      editor.chain().focus().setImage({ src: url, alt: file.name.replace(/\.[^.]+$/, "") }).run()
      toast.dismiss(id)
    } catch (error) {
      toast.error(errorMessage(error), { id })
    }
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false, autolink: true } }),
      Image,
      Markdown,
      Placeholder.configure({ placeholder: placeholder ?? "Write…" }),
    ],
    content: initial,
    contentType: "markdown",
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: { class: "prose-narrative min-h-40 px-4 py-3 outline-none" },
      handlePaste: (_view, event) => {
        const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"))
        if (!file || !editorRef.current) return false
        void upload(editorRef.current, file)
        return true
      },
      handleDrop: (_view, event) => {
        const file = [...(event.dataTransfer?.files ?? [])].find((f) => f.type.startsWith("image/"))
        if (!file || !editorRef.current) return false
        void upload(editorRef.current, file)
        return true
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getMarkdown()),
  })
  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  const setLink = () => {
    const previous: unknown = editor.getAttributes("link").href
    const url = window.prompt("Link address", typeof previous === "string" ? previous : "https://")
    if (url === null) return
    if (url === "") editor.chain().focus().unsetLink().run()
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run()
  }

  return (
    <div className="rounded-lg border bg-card focus-within:ring-[3px] focus-within:ring-ring/30">
      <div className="flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1">
        <ToolButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold />
        </ToolButton>
        <ToolButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic />
        </ToolButton>
        <Divider />
        <ToolButton label="Heading" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 />
        </ToolButton>
        <ToolButton label="Subheading" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          <Heading3 />
        </ToolButton>
        <Divider />
        <ToolButton label="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List />
        </ToolButton>
        <ToolButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered />
        </ToolButton>
        <ToolButton label="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote />
        </ToolButton>
        <ToolButton label="Link" active={editor.isActive("link")} onClick={setLink}>
          <Link2 />
        </ToolButton>
        {programmeId && (
          <ToolButton label="Image" onClick={() => fileInput.current?.click()}>
            <ImagePlus />
          </ToolButton>
        )}
        <span className="ml-auto flex gap-0.5">
          <ToolButton label="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
            <Undo2 />
          </ToolButton>
          <ToolButton label="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
            <Redo2 />
          </ToolButton>
        </span>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void upload(editor, file)
            e.target.value = ""
          }}
        />
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-40 [&_svg]:size-4",
        active && "bg-accent text-accent-foreground",
      )}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-border" />
}
