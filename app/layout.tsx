import type { Metadata } from 'next';
import { Geist,Geist_Mono } from 'next/font/google';
import './globals.css';
const sans=Geist({subsets:['latin'],variable:'--font-sans'});const mono=Geist_Mono({subsets:['latin'],variable:'--font-mono'});
export const metadata:Metadata={title:'Humor Lab · Chain Tool',description:'Build, run and inspect multi-step AI prompt chains.',robots:{index:false,follow:false}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:`try{var t=localStorage.getItem('chain-theme')||'system';document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t==='system'?'light dark':t}catch{}`}}/></head><body>{children}</body></html>}
