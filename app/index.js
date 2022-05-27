"use strict"

const fs = require("fs")
const path = require("path")

const electron = require("electron")
const remote = require("@electron/remote")

const common = require("./lib/common")
const contentBlocking = require("./lib/contentBlocking/contentBlockingRenderer")
const documentRendering = require("./lib/documentRendering/documentRenderingRenderer")
const encodingLib = require("./lib/encoding/encodingRenderer")
const fileLib = require("./lib/file")
const ipc = require("./lib/ipc/ipc")
const log = require("./lib/log/log")
const navigation = require("./lib/navigation/navigationRenderer")
const rawText = require("./lib/rawText/rawTextRenderer")

const TITLE = "Markdown Viewer"

function alterTags(tagName, handler) {
    ;[...document.getElementsByTagName(tagName)].forEach(handler)
}

function updateStatusBar(text) {
    document.getElementById("status-text").innerHTML = text
}

function clearStatusBar() {
    updateStatusBar("")
}

function statusOnMouseOver(element, text) {
    element.onmouseover = () => updateStatusBar(text)
    element.onmouseout = () => clearStatusBar()
}

function alterStyleURLs(documentDirectory, fileContent) {
    const pattern = /url\(["'](?<url>.*?)["']\)/
    let isInStyle = false
    let isInCode = false
    const lines = fileContent.split(/\r?\n/)
    const lineCount = lines.length
    for (let i = 0; i < lineCount; i++) {
        const line = lines[i].trim()
        if (line === "<style>") {
            isInStyle = true
        } else if (line === "</style>") {
            isInStyle = false
        } else if (line.startsWith("```")) {
            isInCode = !isInCode
        }
        if (isInStyle && !isInCode) {
            const url = line.match(pattern)?.groups.url
            if (!url || common.isWebURL(url)) {
                continue
            }
            lines[i] = line.replace(
                pattern,
                `url("${path.join(documentDirectory, url).replace(/\\/g, "/")}")`
            )
        }
    }
    return lines.join("\n")
}

function fittingTarget(target, nodeName) {
    if (!target) {
        return null
    }
    if (target.nodeName === nodeName) {
        return target
    }
    return fittingTarget(target.parentNode, nodeName)
}

function scrollTo(position) {
    document.documentElement.scrollTop = position
}

function reload(isFileModification, encoding) {
    electron.ipcRenderer.send(
        ipc.messages.reloadPrepared,
        isFileModification,
        encoding,
        document.documentElement.scrollTop
    )
}

function handleDOMContentLoadedEvent() {
    document.title = TITLE
    log.init()
    contentBlocking.init(document, window)
    rawText.init(document, window, updateStatusBar)
    navigation.init(document)
    electron.ipcRenderer.send(ipc.messages.finishLoad)
}

function handleContextMenuEvent(event) {
    const MenuItem = remote.MenuItem
    const menu = new remote.Menu()

    if (window.getSelection().toString()) {
        menu.append(
            new MenuItem({
                label: "Copy selection",
                role: "copy",
            })
        )
    }

    const target = fittingTarget(event.target, "A")
    if (target) {
        menu.append(
            new MenuItem({
                label: "Copy link text",
                click() {
                    electron.clipboard.writeText(target.innerText)
                },
            })
        )
        menu.append(
            new MenuItem({
                label: "Copy link target",
                click() {
                    electron.clipboard.writeText(target.getAttribute("href"))
                },
            })
        )
    }

    if (menu.items.length > 0) {
        menu.popup({
            window: remote.getCurrentWindow(),
        })
    }
}

document.addEventListener("DOMContentLoaded", handleDOMContentLoadedEvent)

electron.ipcRenderer.on(ipc.messages.fileOpen, (_, file) => {
    contentBlocking.changeInfoElementVisiblity(false)
    clearStatusBar()

    const filePath = file.path
    const buffer = fs.readFileSync(filePath)
    let encoding = file.encoding
    if (!encoding) {
        encoding = encodingLib.detect(buffer)
        electron.ipcRenderer.send(ipc.messages.changeEncoding, filePath, encoding)
    }
    let content = encodingLib.decode(buffer, encoding)

    if (!fileLib.isMarkdown(filePath)) {
        const pathParts = filePath.split(".")
        const language = pathParts.length > 1 ? pathParts[pathParts.length - 1] : ""
        content = "```" + language + "\n" + content + "\n```"
        electron.ipcRenderer.send(ipc.messages.disableRawView)
    } else {
        electron.ipcRenderer.send(ipc.messages.enableRawView)
    }

    // URLs in cotaining style definitions have to be altered before rendering
    const documentDirectory = path.resolve(path.dirname(filePath))
    content = alterStyleURLs(documentDirectory, content)

    document.getElementById("content").innerHTML = documentRendering.renderContent(content)
    document.getElementById("raw-text").innerHTML = documentRendering.renderRawText(content)

    // Alter local references to be relativ to the document
    alterTags("a", link => {
        const target = link.getAttribute("href")
        if (target) {
            navigation.openLink(link, target, documentDirectory)
            statusOnMouseOver(link, target)
        }
    })
    alterTags("img", image => {
        const imageUrl = image.getAttribute("src")
        if (!common.isWebURL(imageUrl)) {
            image.src = path.join(documentDirectory, imageUrl).replace("#", "%23")
        }
        statusOnMouseOver(image, `${image.getAttribute("alt")} (${imageUrl})`)

        image.onerror = () => (image.style.backgroundColor = "#ffe6cc")
    })

    const scrollPosition = file.scrollPosition
    const internalTarget = file.internalTarget
    let titlePrefix = filePath
    if (scrollPosition) {
        scrollTo(scrollPosition)
    } else if (internalTarget) {
        const targetElement = document.getElementById(internalTarget.replace("#", "").split(".")[0])
        if (targetElement) {
            scrollTo(
                targetElement.getBoundingClientRect().top -
                    document.body.getBoundingClientRect().top
            )
            titlePrefix += internalTarget
        } else {
            titlePrefix += ` ("${internalTarget}" not found)`
        }
    } else {
        scrollTo(0)
    }
    document.title = `${titlePrefix} - ${TITLE} ${remote.app.getVersion()}`

    window.addEventListener("contextmenu", handleContextMenuEvent)
})

electron.ipcRenderer.on(ipc.messages.prepareReload, (_, isFileModification, encoding) =>
    reload(isFileModification, encoding)
)

electron.ipcRenderer.on(ipc.messages.restorePosition, (_, position) => scrollTo(position))

electron.ipcRenderer.on(ipc.messages.changeZoom, (_, zoomFactor) =>
    electron.webFrame.setZoomFactor(zoomFactor)
)

electron.ipcRenderer.on(ipc.messages.changeRenderingOptions, (_, options) => {
    documentRendering.reset(options)
    reload(false)
})
