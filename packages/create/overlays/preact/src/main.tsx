import { render } from 'preact';
import { App } from './App';
import './style.css';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app host');
render(<App />, root);
