import React, { useState } from 'react';
import { ImagePlus, Combine, LayoutGrid, FileType2, FileOutput, ShieldCheck } from 'lucide-react';
import { ThemeProvider } from './lib/ThemeContext.jsx';
import Logo from './components/Logo.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';
import ImageToPdf from './components/tools/ImageToPdf.jsx';
import MergePdfs from './components/tools/MergePdfs.jsx';
import PageEditor from './components/tools/PageEditor.jsx';
import DocxToPdf from './components/tools/DocxToPdf.jsx';
import PdfToWord from './components/tools/PdfToWord.jsx';

const TOOLS = [
  { id: 'image', label: 'Images to PDF', icon: ImagePlus, component: ImageToPdf },
  { id: 'merge', label: 'Merge PDFs', icon: Combine, component: MergePdfs },
  { id: 'edit', label: 'Reorder & edit pages', icon: LayoutGrid, component: PageEditor },
  { id: 'docx', label: 'Word to PDF', icon: FileType2, component: DocxToPdf },
  { id: 'pdf2word', label: 'PDF to Word', icon: FileOutput, component: PdfToWord }
];

function Shell() {
  const [active, setActive] = useState('image');
  const Active = TOOLS.find((t) => t.id === active).component;

  return (
    <div className="min-h-screen bg-paper text-ink [.theme-blossom_&]:bg-blossom-50">
      <header className="glass sticky top-0 z-10 border-b border-ink/5">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3.5">
          <Logo />
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 text-xs text-ink/45 sm:flex">
              <ShieldCheck size={14} /> Most tools run fully in your browser
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-10">
        <div className="mb-8">
          <h1 className="font-display text-3xl leading-tight text-ink sm:text-4xl">
            Build and reshape PDFs, right here.
          </h1>
          <p className="mt-2 max-w-xl text-ink/55">
            Turn images and Word docs into PDFs, merge files, and drag pages into place — all processed locally, gone the moment you close this tab.
          </p>
        </div>

        <nav className="mb-6 flex flex-wrap gap-2">
          {TOOLS.map((t) => {
            const Icon = t.icon;
            const isActive = t.id === active;
            return (
              <button
                key={t.id}
                onClick={() => setActive(t.id)}
                className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors
                  ${isActive
                    ? 'border-ink bg-ink text-white [.theme-blossom_&]:border-blossom-500 [.theme-blossom_&]:bg-blossom-500'
                    : 'border-ink/10 bg-white text-ink/70 hover:border-ink/25 [.theme-blossom_&]:border-blossom-200 [.theme-blossom_&]:hover:border-blossom-400'}`}
              >
                <Icon size={15} />
                {t.label}
              </button>
            );
          })}
        </nav>

        <section className="animate-rise rounded-xl2 border border-ink/8 bg-white/70 p-5 shadow-soft sm:p-7 [.theme-blossom_&]:border-blossom-200">
          <Active />
        </section>
      </main>

      <footer className="mx-auto max-w-5xl px-5 pb-10 pt-4 text-center text-xs text-ink/35">
        Images to PDF, Merge, and Reorder &amp; edit run entirely in your browser. Word to PDF and PDF to Word send your file to our server for high-fidelity conversion, then delete it.
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Shell />
    </ThemeProvider>
  );
}
