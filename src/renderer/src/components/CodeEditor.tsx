import { useCallback, useEffect, useRef } from 'react'
import type { OnMount } from '@monaco-editor/react'
import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
// @ts-ignore - monaco-vim has no types
import { initVimMode, VimMode } from 'monaco-vim'

import { useAppStore } from '../store/useAppStore'

type CodeEditorProps = {
  value: string
  language?: string
  onChange?: (val: string) => void
  onSave?: (val: string) => void
  readOnly?: boolean
}

type VimModeHandle = { dispose: () => void }
type MonacoEditor = monaco.editor.IStandaloneCodeEditor

type MonacoEnv = {
  getWorker: (moduleId: string, label: string) => Worker
}

const ensureMonacoWorkers = () => {
  const globalEnv = globalThis as typeof globalThis & { MonacoEnvironment?: MonacoEnv }
  if (globalEnv.MonacoEnvironment?.getWorker) {
    return
  }
  globalEnv.MonacoEnvironment = {
    getWorker(_moduleId, label) {
      if (label === 'json') {
        return new Worker(
          new URL('monaco-editor/esm/vs/language/json/json.worker?worker', import.meta.url),
          { type: 'module' }
        )
      }
      if (label === 'css' || label === 'scss' || label === 'less') {
        return new Worker(
          new URL('monaco-editor/esm/vs/language/css/css.worker?worker', import.meta.url),
          { type: 'module' }
        )
      }
      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return new Worker(
          new URL('monaco-editor/esm/vs/language/html/html.worker?worker', import.meta.url),
          { type: 'module' }
        )
      }
      if (label === 'typescript' || label === 'javascript') {
        return new Worker(
          new URL('monaco-editor/esm/vs/language/typescript/ts.worker?worker', import.meta.url),
          { type: 'module' }
        )
      }
      return new Worker(
        new URL('monaco-editor/esm/vs/editor/editor.worker?worker', import.meta.url),
        { type: 'module' }
      )
    }
  }
}

ensureMonacoWorkers()
loader.config({ monaco })

const CodeEditor = ({
  value,
  language = 'markdown',
  onChange,
  onSave,
  readOnly = false
}: CodeEditorProps) => {
  const useVimMode = useAppStore((state) => state.useVimMode)
  const editorRef = useRef<MonacoEditor | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const handleEditorDidMount: OnMount = (editor) => {
    editorRef.current = editor
    requestAnimationFrame(() => editor.layout())
    setTimeout(() => editor.layout(), 0)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (onSave) {
        onSave(editor.getValue())
      }
    })
    if (useAppStore.getState().useVimMode && !readOnly) {
      const statusNode = document.getElementById('vim-status-bar')
      if (!statusNode) {
        return
      }
      const vimMode = initVimMode(editor, statusNode) as VimModeHandle
      // @ts-ignore - monaco-vim has no types
      const monacoVim =
        typeof window !== 'undefined' && (window as typeof window & { require?: unknown }).require
          ? // @ts-ignore - require is injected in some environments
            (window as typeof window & { require: (id: string) => unknown }).require('monaco-vim')
          : null
      // @ts-ignore - VimMode is untyped
      const fallbackVim = (VimMode as unknown as { Vim?: unknown })?.Vim ?? null
      const vimModule = monacoVim as unknown
      const resolvedModule = vimModule as
        | { VimMode?: { Vim?: { defineEx?: (...args: unknown[]) => void } } }
        | { Vim?: { defineEx?: (...args: unknown[]) => void } }
        | null
      const Vim =
        (resolvedModule && 'VimMode' in resolvedModule ? resolvedModule.VimMode?.Vim : null) ??
        (resolvedModule && 'Vim' in resolvedModule ? resolvedModule.Vim : null) ??
        fallbackVim
      const vimApi = Vim as {
        defineEx?: (name: string, alias: string, fn: () => void) => void
      } | null
      if (vimApi?.defineEx) {
        vimApi.defineEx('write', 'w', () => {
          if (onSave) {
            onSave(editor.getValue())
          }
        })
      }
      editor.onDidDispose(() => vimMode.dispose())
    }
  }

  useEffect(() => {
    if (!containerRef.current) {
      return
    }
    const observer = new ResizeObserver(() => {
      editorRef.current?.layout()
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const handleChange = useCallback(
    (nextValue?: string) => {
      if (onChange) {
        onChange(nextValue ?? '')
      }
    },
    [onChange]
  )

  const loadingNode = readOnly ? (
    <pre className="code-editor-fallback">{value}</pre>
  ) : (
    <div className="code-editor-fallback">Loading editor...</div>
  )

  return (
    <div className="code-editor" style={{ height: '100%', width: '100%' }}>
      <div
        className="code-editor-body"
        ref={containerRef}
        style={{ height: '100%', width: '100%' }}
      >
        <Editor
          value={value}
          language={language}
          onChange={handleChange}
          onMount={handleEditorDidMount}
          options={{ readOnly, minimap: { enabled: false }, automaticLayout: true }}
          height="100%"
          loading={loadingNode}
        />
      </div>
      {useVimMode && !readOnly ? <div id="vim-status-bar" className="vim-status-bar" /> : null}
    </div>
  )
}

export default CodeEditor
