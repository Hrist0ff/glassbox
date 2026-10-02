import { add, card, link, lines, node, packet, remove, retext, send, set, timer, tone, zoom } from "@/lib/story/dsl";
import type { Story } from "@/lib/story/types";

/** HTTP for beginners: request, response, status codes, cookies, connections. */

const browser = (x = 20, y = 50) => node("browser", x, y, "green", { desc: ["browser"] });
const server = (x = 80, y = 50) => node("server", x, y, "steelblue", { desc: ["example.com"] });
const both = (bx = 20, sx = 80) => [add(browser(bx)), add(server(sx), 300)];

const get = (path: string, then: ReturnType<typeof send>[] = [], after = 0) =>
  send("browser", "server", packet(`GET ${path}`), { after, duration: 1200, then });
const reply = (text: string, then: ReturnType<typeof send>[] = [], after = 300, ink?: Parameters<typeof packet>[1]) =>
  send("server", "browser", packet(text, ink), { after, duration: 1200, then });

/** The browser's "screen": a small card under the browser node. */
const screen = (value: string) => card("screen", 20, 78, lines(value), { font: 9 });

export const http: Story = {
  slug: "http",
  title: "HTTP",
  subtitle: "How Browsers Talk to Servers",
  summary: "Requests, responses, status codes, cookies, and connections: what happens when your browser loads a page.",
  chapters: [
    {
      id: "home",
      title: "Home",
      beats: [{ title: { heading: "HTTP", sub: "How Browsers Talk to Servers" } }],
    },
    {
      id: "intro",
      title: "What is HTTP?",
      beats: [
        { title: { heading: "So what is HTTP?", sub: "Let's start with an example..." } },
        {
          say: "Let's say you type `example.com` into your browser.",
          size: "md",
          run: [add(browser(50), 500)],
        },
        {
          say: "Your [browser|green] is a program that shows web pages. Right now it has nothing to show.",
          size: "md",
          run: [zoom(["browser"]), set("browser", { value: "?" }, 700)],
        },
        {
          say: "The page lives on another computer, called a [server|steelblue].",
          size: "md",
          run: [zoom(null), set("browser", { x: 20, value: "" }, 600), add(server(), 500)],
        },
        {
          say: "To get the page, the browser sends the server a message called a *request*...",
          size: "md",
          run: [get("/")],
        },
        {
          say: "...and the server sends back a *response* that contains the page.",
          size: "md",
          run: [timer("server", 600), reply("200 OK", [add(screen("Hello!"))], 600)],
        },
        {
          say: "These two messages follow a set of rules called *HTTP*: the HyperText Transfer Protocol.",
          size: "md",
        },
        {
          say: "A page usually needs more files, like styles and images. Each one is its own request.",
          size: "md",
          run: [
            get("/style.css", [reply("200 OK")]),
            get("/logo.png", [reply("200 OK")], 400),
            get("/app.js", [reply("200 OK")], 400),
          ],
        },
        { say: "Let's look at what's inside a request.", size: "md" },
      ],
    },
    {
      id: "request",
      title: "The Request",
      beats: [
        { title: { heading: "The Request" } },
        {
          say: "Here is the request the browser sent, written out in full. It's just a few lines of text.",
          size: "md",
          run: [
            ...both(14, 86),
            add(
              card(
                "request",
                50,
                50,
                lines(
                  ["GET /index.html HTTP/1.1", "muted"],
                  ["Host: example.com", "muted"],
                  ["Accept: text/html", "muted"],
                  ["User-Agent: Mozilla/5.0", "muted"],
                  ["", "muted"],
                ),
              ),
              300,
            ),
            zoom(["request"], 900, 4),
          ],
        },
        {
          say: "The first line is the *request line*. It says what the browser wants.",
          run: [tone("request", 0, "focus")],
        },
        {
          say: "`GET` is the *method*. It means \"please send me this\".",
        },
        {
          say: "`/index.html` is the *path*: which page or file on the server.",
        },
        {
          say: "`HTTP/1.1` is the version of HTTP the browser is speaking.",
        },
        {
          say: "Next come the *headers*: extra details, one `Name: value` per line.",
          run: [tone("request", 0, "normal"), tone("request", 1, "focus"), tone("request", 2, "focus"), tone("request", 3, "focus")],
        },
        {
          say: "`Host` names the website, because one server can host many sites...",
          run: [tone("request", 2, "muted"), tone("request", 3, "muted")],
        },
        {
          say: "...`Accept` says what kind of content the browser wants back...",
          run: [tone("request", 1, "normal"), tone("request", 2, "focus")],
        },
        {
          say: "...and `User-Agent` says which browser is asking.",
          run: [tone("request", 2, "normal"), tone("request", 3, "focus")],
        },
        {
          say: "An empty line ends the headers. A `GET` request has nothing after it.",
          run: [tone("request", 3, "normal")],
        },
        {
          say: "Requests that send data, like `POST`, put it in a *body* after the empty line.",
          run: [
            remove("request"),
            add(
              card(
                "post",
                50,
                50,
                lines(
                  ["POST /signup HTTP/1.1", "focus"],
                  "Host: example.com",
                  "Content-Type: application/json",
                  "",
                  ['{"name": "Ada"}', "focus"],
                ),
              ),
              200,
            ),
            zoom(["post"], 100, 4),
          ],
        },
        {
          say: "The method tells the server what to do: `GET` reads, `POST` creates, `PUT` replaces, `DELETE` removes.",
          size: "md",
          run: [
            remove("post"),
            add(card("methods", 50, 50, lines(["GET     read", "focus"], "POST    create", "PUT     replace", "DELETE  remove"), { font: 9 }), 200),
            zoom(["methods"], 100, 6),
          ],
        },
        {
          say: "Now the browser sends its request to the server...",
          run: [remove("methods"), zoom(null, 200), get("/index.html", [], 600)],
        },
        {
          say: "...which reads it, finds the page, and prepares an answer.",
          run: [set("server", { desc: ["example.com", "working..."] }), timer("server", 1400)],
        },
      ],
    },
    {
      id: "response",
      title: "The Response",
      beats: [
        { title: { heading: "The Response" } },
        {
          say: "The server's answer has the same shape: a first line, headers, and then a body.",
          size: "md",
          run: [
            ...both(14, 86),
            add(
              card(
                "response",
                50,
                50,
                lines(
                  ["HTTP/1.1 200 OK", "muted"],
                  ["Content-Type: text/html", "muted"],
                  ["Content-Length: 15", "muted"],
                  ["", "muted"],
                  ["<h1>Hello!</h1>", "muted"],
                ),
              ),
              300,
            ),
            zoom(["response"], 900, 4),
          ],
        },
        {
          say: "The first line holds the *status code*. `200 OK` means everything worked.",
          run: [tone("response", 0, "good")],
        },
        {
          say: "Headers describe the body: what kind of content it is, and how many bytes long.",
          run: [tone("response", 1, "focus"), tone("response", 2, "focus")],
        },
        {
          say: "After the empty line comes the body: the page itself.",
          run: [tone("response", 1, "normal"), tone("response", 2, "normal"), tone("response", 4, "focus")],
        },
        {
          say: "The response travels back, and the browser draws the page.",
          run: [
            remove("response"),
            zoom(null, 200),
            send("server", "browser", packet("200 OK"), {
              after: 600,
              duration: 1200,
              then: [add(card("screen", 14, 78, lines("Hello!"), { font: 9 }))],
            }),
          ],
        },
        {
          say: "Status codes are grouped by their first digit.",
          run: [
            add(
              card(
                "codes",
                50,
                50,
                lines(["2xx  it worked", "good"], ["3xx  look elsewhere", "focus"], ["4xx  the client made a mistake", "bad"], ["5xx  the server made a mistake", "bad"]),
                { font: 9 },
              ),
            ),
          ],
        },
        {
          say: "Ask for a page that doesn't exist, and the server answers `404 Not Found`.",
          run: [
            remove("codes"),
            send("browser", "server", packet("GET /nope"), {
              after: 300,
              duration: 1200,
              then: [
                send("server", "browser", packet("404 Not Found", "red"), {
                  after: 300,
                  duration: 1200,
                  then: [retext("screen", 0, { text: "Not Found", tone: "bad" })],
                }),
              ],
            }),
          ],
        },
        {
          say: "If a page has moved, the server answers `301 Moved Permanently`, with the new address in a `Location` header...",
          size: "md",
          run: [
            send("browser", "server", packet("GET /old"), {
              duration: 1200,
              then: [send("server", "browser", packet("301 Location: /new", "steelblue"), { after: 300, duration: 1200 })],
            }),
          ],
        },
        {
          say: "...and the browser requests the new address on its own.",
          run: [
            send("browser", "server", packet("GET /new"), {
              duration: 1200,
              then: [
                send("server", "browser", packet("200 OK"), {
                  after: 300,
                  duration: 1200,
                  then: [retext("screen", 0, { text: "Hello!", tone: "normal" })],
                }),
              ],
            }),
          ],
        },
        {
          say: "And if something breaks on the server, it answers with a `5xx` code, like `500 Internal Server Error`.",
          size: "md",
          run: [
            send("browser", "server", packet("GET /cart"), {
              duration: 1200,
              then: [
                set("server", { fill: "red" }),
                send("server", "browser", packet("500 Server Error", "red"), {
                  after: 500,
                  duration: 1200,
                  then: [retext("screen", 0, { text: "Error", tone: "bad" }), set("server", { fill: "steelblue" }, 300)],
                }),
              ],
            }),
          ],
        },
      ],
    },
    {
      id: "cookies",
      title: "Cookies",
      beats: [
        { title: { heading: "Cookies" } },
        {
          say: "HTTP is *stateless*: the server handles each request on its own and then forgets about it.",
          size: "md",
          run: [...both()],
        },
        { say: "So how does a shop remember that you're logged in?", size: "md" },
        {
          say: "First you log in. The browser sends your name and password in a `POST` request.",
          size: "md",
          run: [send("browser", "server", packet("POST /login"), { duration: 1200 })],
        },
        {
          say: "The server checks them, starts a *session* for you, and files it under a random id.",
          size: "md",
          run: [timer("server", 800), add(card("sessions", 80, 78, lines(["sessions", "muted"], ["abc → Ada", "focus"]), { font: 9 }), 800)],
        },
        {
          say: "It sends that id back in a `Set-Cookie` header.",
          run: [
            send("server", "browser", packet("Set-Cookie: id=abc", "steelblue"), {
              duration: 1400,
              then: [add(card("cookies", 20, 78, lines(["cookies", "muted"], ["id=abc", "focus"]), { font: 9 }))],
            }),
          ],
        },
        {
          say: "The browser keeps the cookie, and from now on adds it to every request to that site.",
          size: "md",
          run: [tone("sessions", 1, "normal"), send("browser", "server", packet("GET /cart  Cookie: id=abc"), { after: 300, duration: 1400 })],
        },
        {
          say: "The server looks up `abc`, finds Ada's session, and answers with her cart.",
          size: "md",
          run: [tone("sessions", 1, "focus"), send("server", "browser", packet("200 Ada's cart"), { after: 700, duration: 1200 })],
        },
        {
          say: "Each request still stands alone. The cookie just carries the state along with it.",
          size: "md",
          run: [tone("sessions", 1, "normal"), tone("cookies", 1, "normal")],
        },
        {
          say: "That's also why a stolen session cookie is dangerous: whoever sends it looks like you.",
          size: "md",
          run: [tone("cookies", 1, "bad")],
        },
      ],
    },
    {
      id: "connections",
      title: "Connections",
      beats: [
        { title: { heading: "Connections" } },
        {
          say: "HTTP messages travel over a *TCP connection*, a reliable two-way channel between the two computers.",
          size: "md",
          run: [...both()],
        },
        {
          say: "Before the first request, the browser and server open a connection with three small messages.",
          size: "md",
          run: [
            send("browser", "server", packet("SYN"), {
              duration: 1000,
              then: [
                send("server", "browser", packet("SYN-ACK"), {
                  duration: 1000,
                  then: [send("browser", "server", packet("ACK"), { duration: 1000, then: [add(link("tcp", "browser", "server"))] })],
                }),
              ],
            }),
          ],
        },
        {
          say: "That costs a full round trip before any HTTP is sent.",
          run: [set("browser", { desc: ["browser", "waited 1 round trip"] })],
        },
        {
          say: "With `https://`, a *TLS handshake* follows to agree on encryption keys. That's another round trip.",
          size: "md",
          run: [
            send("browser", "server", packet("TLS hello"), {
              duration: 1000,
              then: [
                send("server", "browser", packet("TLS hello + cert"), {
                  duration: 1000,
                  then: [set("browser", { desc: ["browser", "waited 2 round trips"] })],
                }),
              ],
            }),
          ],
        },
        {
          say: "Setting up is slow, so the connection stays open and is reused for the next requests.",
          size: "md",
          run: [set("browser", { desc: ["browser"] }), get("/index.html", [reply("200 OK")], 300)],
        },
        {
          say: "On one HTTP/1.1 connection, requests take turns. Each one waits for the previous response.",
          size: "md",
          run: [
            send("browser", "server", packet("GET /a"), {
              duration: 900,
              then: [
                send("server", "browser", packet("200 /a"), {
                  after: 200,
                  duration: 900,
                  then: [
                    send("browser", "server", packet("GET /b"), {
                      duration: 900,
                      then: [
                        send("server", "browser", packet("200 /b"), {
                          after: 200,
                          duration: 900,
                          then: [
                            send("browser", "server", packet("GET /c"), {
                              duration: 900,
                              then: [send("server", "browser", packet("200 /c"), { after: 200, duration: 900 })],
                            }),
                          ],
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        },
        {
          say: "HTTP/2 can send many requests at once over the same connection, and answers come back as soon as they're ready.",
          size: "md",
          run: [
            send("browser", "server", packet("GET /a"), { duration: 900, then: [reply("200 /a", [], 500)] }),
            send("browser", "server", packet("GET /b"), { after: 200, duration: 900, then: [reply("200 /b", [], 100)] }),
            send("browser", "server", packet("GET /c"), { after: 200, duration: 900, then: [reply("200 /c", [], 900)] }),
          ],
        },
        {
          say: "HTTP/3 does the same over *QUIC*, which also folds the connection and TLS handshakes into one round trip.",
          size: "md",
        },
      ],
    },
    {
      id: "recap",
      title: "Recap",
      beats: [
        { title: { heading: "Recap" } },
        {
          say: "HTTP is a conversation: the client sends a *request*, and the server answers with a *response*.",
          size: "md",
          run: [...both(), get("/", [reply("200 OK", [], 400)], 600)],
        },
        { say: "Both are plain text: a first line, headers, an empty line, and an optional body.", size: "md" },
        { say: "Status codes say how it went, cookies carry state between requests, and connections are reused to save time.", size: "md" },
        {
          say: "Want to go deeper?",
          size: "md",
          links: [
            { text: "MDN: HTTP", href: "https://developer.mozilla.org/en-US/docs/Web/HTTP" },
            { text: "RFC 9110: HTTP Semantics", href: "https://www.rfc-editor.org/rfc/rfc9110" },
          ],
        },
      ],
    },
  ],
};
