## Project structure 

root/
|-- src/
/   / assets/
/   / styles/
/   / scripts/
/   / index.html
/   / package.json
/   / README.md

what's needed is a termux install script that will install all the dependencies and set up the project. and setup cloudflared to tunnel the project to the internet. as well as a script that initializes the databank and creates the necessary tables. there should be an one command setup that takes the install script form the public git repo and istalls everything nessessary.
it also should always update from the public git repo if update is available. this maintain tool should install new requierments and update existing ones. it should also run migrations on the databank if needed. so basically a self updating and self maintaining system.

what needs to be installed:
- nodejs
- npm
- git
- cloudflared
- MariaDB

Languages:
- HTML
- CSS
- JavaScript
- SQL
- Bash

this website is a hub for my work and some minigames i want to make. For example the index file is a welcome page and you can look into more stuff like an art gallery, a blog, a credits page, a page with some tools i want to make as well as some small games and also some cool ARG stuff