import './styles.css';
import { createApp } from './app';

const root = document.querySelector<HTMLElement>('#app');

if (!root) {
  throw new Error('Renderer root element was not found.');
}

createApp(root);
