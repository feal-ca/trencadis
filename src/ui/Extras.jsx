import About from './About.jsx';
import { SAMPLES } from './useEngine.js';

// The samples and the Ko-fi link: in the header on a desktop, at the end of the
// sheet's body on a phone, where the header keeps to one line.
export default function Extras({ engine }) {
  return (
    <>
      <span className="samples muted">
        o prueba con{' '}
        {SAMPLES.map((s, i) => (
          <span key={s.src}>
            {i > 0 && ', '}
            <button type="button" className="link" onClick={() => engine.loadSample(s.src)}>{s.label}</button>
          </span>
        ))}
      </span>
      <About />
      <a className="kofi link" href="https://ko-fi.com/fealca" target="_blank" rel="noopener">Invítame a un café</a>
    </>
  );
}
