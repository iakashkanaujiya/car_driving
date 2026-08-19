import './style.css';
import { DrivingApplication } from './app/DrivingApplication';
import { createGameTemplate } from './ui/gameTemplate';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('App root is missing');

root.innerHTML = createGameTemplate();
new DrivingApplication().start();
