import { Routes, Route, useLocation } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import Home from './pages/Home'
import Browse from './pages/Browse'
import SchemeDetail from './pages/SchemeDetail'
import Finder from './pages/Finder'
import Programs from './pages/Programs'

export default function App() {
  const location = useLocation()

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route path="/"            element={<Home />} />
            <Route path="/browse"      element={<Browse />} />
            <Route path="/scheme/:id"  element={<SchemeDetail />} />
            <Route path="/finder"      element={<Finder />} />
            <Route path="/programs"    element={<Programs />} />
          </Routes>
        </AnimatePresence>
      </main>
      <Footer />
    </div>
  )
}
