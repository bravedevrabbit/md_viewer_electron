const assert = require("chai").assert

const toc = require("../app/lib/renderer/toc")

describe('Library "TOC"', () => {
    it("recognizes a header", () => {
        const headerText = "Some header"
        const content = `# ${headerText}`
        assert.isTrue(
            toc.build(content).equals(
                toc.Section.fromObject({
                    subSections: [
                        {
                            header: headerText,
                            subSection: [],
                        },
                    ],
                })
            )
        )
    })

    it("recognizes two headers", () => {
        const headerText1 = "Header 1"
        const headerText2 = "Header 2"
        const content = `
            # ${headerText1}

            # ${headerText2}
        `
        assert.isTrue(
            toc.build(content).equals(
                toc.Section.fromObject({
                    subSections: [
                        {
                            header: headerText1,
                            subSection: [],
                        },
                        {
                            header: headerText2,
                            subSection: [],
                        },
                    ],
                })
            )
        )
    })
})
