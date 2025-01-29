const { test } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const sharp = require("sharp");
const config = require("../config.js");

let pixelmatch;
let chalk;

// Dynamically load `pixelmatch` and `chalk`
(async () => {
  pixelmatch = (await import("pixelmatch")).default;
  chalk = (await import("chalk")).default;
})();

// Helper Functions

// Ensure directory exists
function ensureDirectoryExistence(filePath) {
  const dirname = path.dirname(filePath);
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, { recursive: true });
  }
}

// Resize images to match specified dimensions (1280x800)
async function resizeImage(imagePath, width, height) {
  const buffer = fs.readFileSync(imagePath);
  const resizedBuffer = await sharp(buffer)
    .resize(width, height, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .toBuffer();
  fs.writeFileSync(imagePath, resizedBuffer);
}

// Compare two screenshots and return similarity percentage
async function compareScreenshots(baselinePath, currentPath, diffPath) {
  if (!fs.existsSync(baselinePath) || !fs.existsSync(currentPath)) {
    console.log(
      chalk.red(`Missing file(s): ${baselinePath} or ${currentPath}`)
    );
    return "Error";
  }

  await resizeImage(baselinePath, 1280, 800);
  await resizeImage(currentPath, 1280, 800);

  const img1 = PNG.sync.read(fs.readFileSync(baselinePath)); // Staging
  const img2 = PNG.sync.read(fs.readFileSync(currentPath)); // Prod

  if (img1.width !== img2.width || img1.height !== img2.height) {
    console.log(
      chalk.red(`Size mismatch for ${baselinePath} and ${currentPath}`)
    );
    return "Size mismatch";
  }

  const diff = new PNG({ width: img1.width, height: img1.height });

  pixelmatch(img1.data, img2.data, diff.data, img1.width, img1.height, {
    threshold: 0.1,
    diffColor: [0, 0, 255], // Blue for Prod Differences
    diffColorAlt: [255, 165, 0], // Orange for Staging Differences
  });

  fs.writeFileSync(diffPath, PNG.sync.write(diff));

  const totalPixels = img1.width * img1.height;
  const mismatchedPixels = pixelmatch(
    img1.data,
    img2.data,
    null,
    img1.width,
    img1.height,
    { threshold: 0.1 }
  );

  const matchedPixels = totalPixels - mismatchedPixels;
  return (matchedPixels / totalPixels) * 100;
}

// Capture screenshot for a given URL
async function captureScreenshot(page, url, screenshotPath) {
  try {
    console.log(chalk.blue(`Navigating to: ${url}`));
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

    ensureDirectoryExistence(screenshotPath);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(chalk.green(`Screenshot captured: ${screenshotPath}`));
  } catch (error) {
    console.error(
      chalk.red(`Failed to capture screenshot for ${url}: ${error.message}`)
    );
  }
}

// Generate HTML report
function generateHtmlReport(results, deviceName) {
  const reportPath = `visual_comparison_report_${deviceName}.html`;
  const now = new Date().toLocaleString();
  const environments = `
    <a href="${config.staging.baseUrl}" target="_blank" class="staging">Staging</a>,
    <a href="${config.prod.baseUrl}" target="_blank" class="prod">Prod</a>
  `;

  // Sort results: Failures first, then Pass
  results.sort((a, b) => {
    const aStatus =
      typeof a.similarityPercentage === "number" && a.similarityPercentage >= 95
        ? 1
        : 0;
    const bStatus =
      typeof b.similarityPercentage === "number" && b.similarityPercentage >= 95
        ? 1
        : 0;
    return aStatus - bStatus;
  });

  let htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <title>Visual Comparison Report - ${deviceName}</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.5; margin: 20px; }
        h1, h2 { text-align: center; }
        .summary { text-align: center; margin: 20px 0; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: center; }
        th { background-color: #f2f2f2; }
        .pass { color: green; font-weight: bold; }
        .fail { color: red; font-weight: bold; }
        .error { color: orange; font-weight: bold; }
        img { max-width: 200px; cursor: pointer; margin: 5px; }
        .staging { color: rgb(255, 165, 0); font-weight: bold; }
        .prod { color: rgb(0, 0, 255); font-weight: bold; }
        .thumbnail-wrapper { display: inline-block; text-align: center; margin: 5px; }
        .thumbnail-label { font-size: 12px; font-weight: bold; margin-top: 5px; }
        .modal { display: none; position: fixed; z-index: 1000; padding: 50px; left: 0; top: 0; width: 100%; height: 100%; overflow: auto; background-color: rgba(0,0,0,0.8); }
        .modal img { margin: auto; display: block; max-width: 90%; max-height: 90%; }
        .modal-close { position: absolute; top: 20px; right: 30px; font-size: 30px; font-weight: bold; color: white; cursor: pointer; }
        .download-button { display: block; text-align: center; margin: 20px auto; padding: 10px 20px; font-size: 18px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px; width: 200px; }
      </style>
    </head>
    <body>
      <h1>Visual Comparison Report</h1>
      <h2>Device: ${deviceName}</h2>
      <div class="summary">
        <p>Total Pages Tested: ${results.length}</p>
        <p>Failed: ${
          results.filter(
            (r) =>
              typeof r.similarityPercentage === "number" &&
              r.similarityPercentage < 95
          ).length
        }</p>
        <p>Passed: ${
          results.filter(
            (r) =>
              typeof r.similarityPercentage === "number" &&
              r.similarityPercentage >= 95
          ).length
        }</p>
        <p>Errors: ${
          results.filter((r) => r.similarityPercentage === "Error").length
        }</p>
        <p>Last Run: ${now}</p>
        <p>Environments Tested: ${environments}</p>
        <a href="${reportPath}" download class="download-button">Download Report</a>
      </div>
      <table>
        <thead>
          <tr>
            <th>Page</th>
            <th>Similarity</th>
            <th>Status</th>
            <th>Thumbnails</th>
          </tr>
        </thead>
        <tbody>
  `;

  results.forEach((result) => {
    const sanitizedPath = result.pagePath.replace(/\//g, "_");
    const stagingPath = `screenshots/${deviceName}/staging/${sanitizedPath}.png`;
    const prodPath = `screenshots/${deviceName}/prod/${sanitizedPath}.png`;
    const diffPath = `screenshots/${deviceName}/diff/${sanitizedPath}.png`;

    htmlContent += `
      <tr>
        <td><a href="${config.staging.baseUrl}${
      result.pagePath
    }" class="staging">Staging</a> |
            <a href="${config.prod.baseUrl}${
      result.pagePath
    }" class="prod">Prod</a>
        </td>
        <td>${
          typeof result.similarityPercentage === "number"
            ? result.similarityPercentage.toFixed(2) + "%"
            : "Error"
        }</td>
        <td class="${result.similarityPercentage >= 95 ? "pass" : "fail"}">${
      result.similarityPercentage >= 95 ? "Pass" : "Fail"
    }</td>
        <td>
          <div class="thumbnail-wrapper"><img src="${stagingPath}" onclick="openModal('${stagingPath}')" alt="Staging"><div class="thumbnail-label">Staging</div></div>
          <div class="thumbnail-wrapper"><img src="${prodPath}" onclick="openModal('${prodPath}')" alt="Prod"><div class="thumbnail-label">Prod</div></div>
          <div class="thumbnail-wrapper"><img src="${diffPath}" onclick="openModal('${diffPath}')" alt="Diff"><div class="thumbnail-label">Diff</div></div>
        </td>
      </tr>
    `;
  });

  htmlContent += `
        </tbody>
      </table>

      <div id="modal" class="modal">
        <span class="modal-close" onclick="closeModal()">&times;</span>
        <img id="modal-image">
      </div>

      <script>
        function openModal(imageSrc) {
          document.getElementById("modal-image").src = imageSrc;
          document.getElementById("modal").style.display = "block";
        }
        function closeModal() {
          document.getElementById("modal").style.display = "none";
        }
      </script>
    </body>
    </html>
  `;

  fs.writeFileSync(reportPath, htmlContent);
}

// Main Test Suite
test.describe("Visual Comparison Tests", () => {
  test.setTimeout(7200000);
  test("Compare staging and prod screenshots and generate HTML report", async ({
    browser,
  }) => {
    const results = [];
    const deviceName = "Desktop";

    console.log(chalk.blue("Running tests..."));

    const baseDir = `screenshots/${deviceName}`;
    ["staging", "prod", "diff"].forEach((dir) => {
      if (!fs.existsSync(path.join(baseDir, dir))) {
        fs.mkdirSync(path.join(baseDir, dir), { recursive: true });
      }
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    for (const pagePath of config.staging.urls) {
      const stagingUrl = `${config.staging.baseUrl}${pagePath}`;
      const prodUrl = `${config.prod.baseUrl}${pagePath}`;
      const stagingScreenshotPath = path.join(
        baseDir,
        "staging",
        `${pagePath.replace(/\//g, "_")}.png`
      );
      const prodScreenshotPath = path.join(
        baseDir,
        "prod",
        `${pagePath.replace(/\//g, "_")}.png`
      );
      const diffScreenshotPath = path.join(
        baseDir,
        "diff",
        `${pagePath.replace(/\//g, "_")}.png`
      );

      try {
        await captureScreenshot(page, stagingUrl, stagingScreenshotPath);
        await captureScreenshot(page, prodUrl, prodScreenshotPath);

        const similarity = await compareScreenshots(
          stagingScreenshotPath,
          prodScreenshotPath,
          diffScreenshotPath
        );

        results.push({ pagePath, similarityPercentage: similarity });
      } catch (error) {
        results.push({
          pagePath,
          similarityPercentage: "Error",
          error: error.message,
        });
      }
    }

    generateHtmlReport(results, deviceName);
    await context.close();
  });

  test("Verify broken image links automatically on staging pages from config.js", async ({
    page,
  }) => {
    const stagingUrls = config.staging.urls.map(
      (url) => `${config.staging.baseUrl}${url}`
    );

    for (const url of stagingUrls) {
      console.log(chalk.blue(`Navigating to: ${url}`));
      await page.goto(url, { waitUntil: "domcontentloaded" });
      console.log(chalk.green(`Page loaded successfully: ${url}`));

      console.log(chalk.blue("Finding all image elements on the page..."));
      const images = await page.locator("img");
      const imageCount = await images.count();
      console.log(chalk.green(`Found ${imageCount} images on the page.`));

      let brokenImages = 0;

      for (let i = 0; i < imageCount; i++) {
        let imageUrl = await images.nth(i).getAttribute("src");

        if (!imageUrl) {
          console.log(
            chalk.yellow(`Image ${i + 1} does not have a valid src attribute.`)
          );
          brokenImages++;
          continue;
        }

        // Handle relative and protocol-relative URLs
        if (!imageUrl.startsWith("http") && !imageUrl.startsWith("//")) {
          imageUrl = new URL(imageUrl, url).toString();
        } else if (imageUrl.startsWith("//")) {
          imageUrl = `https:${imageUrl}`;
        }

        // Exclude known tracking pixels or problematic URLs
        if (
          imageUrl.includes("bat.bing.com") ||
          imageUrl.includes("tracking")
        ) {
          console.log(
            chalk.yellow(
              `Image ${i + 1} is a tracking pixel or excluded URL: ${imageUrl}`
            )
          );
          continue;
        }

        try {
          console.log(chalk.blue(`Checking image ${i + 1}: ${imageUrl}`));
          const response = await axios.get(imageUrl);

          if (response.status !== 200) {
            console.log(
              chalk.red(
                `Image ${i + 1} failed to load. Status Code: ${response.status}`
              )
            );
            brokenImages++;
          } else {
            console.log(chalk.green(`Image ${i + 1} loaded successfully.`));
          }
        } catch (error) {
          console.log(
            chalk.red(`Image ${i + 1} failed to load. Error: ${error.message}`)
          );
          brokenImages++;
        }
      }

      if (brokenImages > 0) {
        console.log(
          chalk.red(
            `Test failed for ${url}. Found ${brokenImages} broken images on the page.`
          )
        );
      } else {
        console.log(
          chalk.green(
            `Test passed for ${url}. No broken images found on the page.`
          )
        );
      }
    }
  });

  test("Fill out the form one field at a time and submit (Staging Only)", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      const formPageUrl = `${config.staging.baseUrl}${config.staging.urls[0]}`;
      console.log(chalk.blue(`Navigating to the staging page: ${formPageUrl}`));

      await page.goto(formPageUrl, { waitUntil: "domcontentloaded" });
      console.log(chalk.green("Page loaded successfully on staging."));

      // Click the "Request Info" button to open the form
      console.log(chalk.blue("Clicking the 'Request Info' button..."));
      await page.click("button.request-info-hero");

      // Wait for the form to appear
      console.log(chalk.blue("Waiting for the form to appear..."));
      await page.waitForSelector("#gform_wrapper_8", { timeout: 10000 });
      console.log(chalk.green("Form is now visible."));

      // Fill out the form fields
      console.log(chalk.blue("Filling out the form fields..."));
      await page.selectOption("#input_8_1", { value: "YSU-M-MBA" });
      await page.fill("#input_8_2", `John${Date.now()}`);
      await page.fill("#input_8_3", "Doe");
      await page.fill("#input_8_5", `johndoe${Date.now()}@example.com`);
      await page.fill("#input_8_6", "5551234567");
      await page.fill("#input_8_7", "12345");
      await page.selectOption("#input_8_8", { value: "Email" });
      console.log(chalk.green("Form fields filled successfully."));

      // Submit the form
      console.log(chalk.blue("Submitting the form..."));
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }),
        page.click("#gform_submit_button_8"),
      ]);
      console.log(chalk.green("Form submitted successfully on staging."));

      // Verify the confirmation message
      console.log(chalk.blue("Verifying the confirmation message..."));
      await page.waitForSelector("h1.header2", { timeout: 20000 });
      const confirmationText = await page.textContent("h1.header2");

      // Check if the confirmation text matches the expected value
      const normalizedText = confirmationText.trim().toLowerCase();
      const expectedText = "Thanks for your submission!".toLowerCase();

      if (normalizedText === expectedText) {
        console.log(
          chalk.green("Confirmation message matches the expected value.")
        );
      } else {
        console.error(
          chalk.red(
            `Confirmation message mismatch. Found: "${confirmationText.trim()}"`
          )
        );
        throw new Error("Confirmation message mismatch.");
      }
    } catch (error) {
      console.error(chalk.red(`Error during test: ${error.message}`));
    } finally {
      await context.close();
    }
  });

  test("Click Apply Now, fill out the form, and submit (Staging Only)", async ({
    page,
  }) => {
    const homePageUrl = `${config.staging.baseUrl}`;
    const formPageUrl = `${config.staging.baseUrl}apply/`;
    const confirmationUrlPattern = /apply2\/\?d=.+/; // Matches the confirmation URL pattern
    const formSelectors = {
      applyNowButton:
        "li.menu-item.menu-item-type-post_type.menu-item-object-page.menu-item-666 a.elementor-item",
      programOfInterest: "#input_4_1",
      firstName: "#input_4_2",
      lastName: "#input_4_3",
      email: "#input_4_4",
      phone: "#input_4_5",
      zipCode: "#input_4_6",
      howDidYouHear: "#input_4_7",
      submitButton: "#gform_submit_button_4",
      confirmationMessage: "h1.header2",
    };

    try {
      // Navigate to the homepage
      console.log(chalk.blue(`Navigating to the home page: ${homePageUrl}`));
      await page.goto(homePageUrl, { waitUntil: "domcontentloaded" });
      console.log(chalk.green("Homepage loaded successfully."));

      // Click on the "Apply Now" button
      console.log(chalk.blue("Clicking on the 'Apply Now' button..."));
      await page.click(formSelectors.applyNowButton);

      // Wait for the form page to load
      console.log(
        chalk.blue(`Waiting for navigation to the form page: ${formPageUrl}`)
      );
      await page.waitForURL(formPageUrl, { timeout: 10000 });
      console.log(chalk.green("Navigated to the Apply Now form page."));

      // Fill out the form fields
      const testData = {
        program: "YSU-M-MBAHRMGMT", // Example program value
        firstName: "Jane",
        lastName: "Doe",
        email: `janedoe${Date.now()}@example.com`, // Unique email for testing
        phone: "5551234567",
        zipCode: "67890",
        howDidYouHear: "Email",
      };

      console.log(chalk.blue("Filling out the Apply Now form fields..."));
      await page.selectOption(formSelectors.programOfInterest, {
        value: testData.program,
      });
      console.log(chalk.green(`Selected program: ${testData.program}`));

      await page.fill(formSelectors.firstName, testData.firstName);
      console.log(chalk.green(`Filled First Name: ${testData.firstName}`));

      await page.fill(formSelectors.lastName, testData.lastName);
      console.log(chalk.green(`Filled Last Name: ${testData.lastName}`));

      await page.fill(formSelectors.email, testData.email);
      console.log(chalk.green(`Filled Email: ${testData.email}`));

      await page.fill(formSelectors.phone, testData.phone);
      console.log(chalk.green(`Filled Phone: ${testData.phone}`));

      await page.fill(formSelectors.zipCode, testData.zipCode);
      console.log(chalk.green(`Filled ZIP Code: ${testData.zipCode}`));

      await page.selectOption(formSelectors.howDidYouHear, {
        value: testData.howDidYouHear,
      });
      console.log(
        chalk.green(`Selected How Did You Hear: ${testData.howDidYouHear}`)
      );

      console.log(chalk.green("Form fields filled successfully."));

      console.log(chalk.blue("Submitting the Apply Now form..."));
      await Promise.all([
        page.waitForURL(confirmationUrlPattern, { timeout: 30000 }),
        page.click(formSelectors.submitButton),
      ]);
      console.log(chalk.green("Form submitted successfully."));

      console.log(chalk.blue("Verifying confirmation message..."));
      await page.waitForSelector(formSelectors.confirmationMessage, {
        timeout: 20000,
      });
      const confirmationText = await page.textContent(
        formSelectors.confirmationMessage
      );

      // Verify the confirmation message
      console.log(
        chalk.blue(`Confirmation message found: "${confirmationText.trim()}"`)
      );
      if (confirmationText.trim() === "Great! Now, take the next step.") {
        console.log(
          chalk.green("Confirmation message matches expected value.")
        );
      } else {
        console.error(
          chalk.red(
            `Confirmation message mismatch. Found: "${confirmationText.trim()}"`
          )
        );
        throw new Error("Confirmation message mismatch.");
      }
    } catch (error) {
      console.error(chalk.red(`Test failed: ${error.message}`));
    }
  });
});
